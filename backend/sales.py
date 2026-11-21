"""CCMC RetailFlow Sales/POS routes; compatible with the existing schema.sql."""
import os
from decimal import Decimal, InvalidOperation

from flask import Blueprint, jsonify, request, session
from db import get_db_connection

# Shared helpers included here; module_helpers.py is no longer needed.
import logging
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps
from uuid import uuid4
from datetime import timedelta

from flask import jsonify, session


class BusinessError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def fail(message, status=400):
    raise BusinessError(message, status)


def money(value):
    try:
        value = Decimal(str(value))
        if not value.is_finite():
            raise ValueError("Non-finite number")
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        fail("Invalid currency amount.")


def today_ph():
    """Reservations expire after their expiry_date in Philippine local time."""
    return datetime.now(timezone(timedelta(hours=8))).date()


def encode(value):
    """Convert MySQL/TiDB result values to JSON-safe values."""
    if isinstance(value, list):
        return [encode(v) for v in value]
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        # Transactions are created with UTC_TIMESTAMP() in these routes.
        return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if value.tzinfo is None else value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def ref(prefix, identifier):
    return f"{prefix}-{int(identifier):06d}"


def temporary_ref():
    return "TMP-" + uuid4().hex


def auth_required(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify(success=False, message="Authentication required."), 401
        if session.get("role") not in ("Staff", "Owner"):
            return jsonify(success=False, message="Staff or Owner access required."), 403
        return function(*args, **kwargs)
    return wrapped


def endpoint(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except BusinessError as exc:
            return jsonify(success=False, message=str(exc)), exc.status
        except Exception:
            logging.exception("RetailFlow transaction failed")
            return jsonify(
                success=False,
                message="Could not complete the request. No transaction was confirmed; check with the administrator.",
            ), 500
    return wrapped


def parse_items(items):
    if not isinstance(items, list) or not 1 <= len(items) <= 80:
        fail("Choose between 1 and 80 line items.")
    totals = {}
    for item in items:
        if not isinstance(item, dict):
            fail("Invalid product line item.")
        product_id, quantity = item.get("product_id"), item.get("quantity")
        if (isinstance(product_id, bool) or isinstance(quantity, bool)
                or not str(product_id).isdigit() or not str(quantity).isdigit()):
            fail("Product ID and quantity must be positive whole numbers.")
        product_id, quantity = int(product_id), int(quantity)
        if product_id < 1 or not 1 <= quantity <= 999:
            fail("Invalid product ID or quantity.")
        totals[product_id] = totals.get(product_id, 0) + quantity
        if totals[product_id] > 999:
            fail("Maximum 999 units per product.")
    return totals


def locked_products(cursor, quantities, excluded_order=None):
    """Lock stock rows, account for active reservation soft holds, and validate quantities.

    Caller must commit/rollback the transaction. The original schema stores the
    expiry as DATE, so a hold stays active through that calendar date (PHT).
    """
    result = {}
    for product_id in sorted(quantities):
        cursor.execute(
            """SELECT product_id,item_code,product_name,selling_price,cost_price,
                      current_qty,min_stock_level FROM products
               WHERE product_id=%s FOR UPDATE""",
            (product_id,),
        )
        product = cursor.fetchone()
        if not product:
            fail("One of the products no longer exists.", 404)
        sql = """SELECT COALESCE(SUM(oi.quantity),0) AS held
                 FROM order_items oi JOIN orders o ON o.order_id=oi.order_id
                 WHERE oi.product_id=%s AND o.status='Pending'
                   AND o.expiry_date >= %s"""
        params = [product_id, today_ph()]
        if excluded_order is not None:
            sql += " AND o.order_id <> %s"
            params.append(excluded_order)
        cursor.execute(sql, tuple(params))
        held = int(cursor.fetchone()["held"])
        product["available_qty"] = max(0, int(product["current_qty"]) - held)
        if quantities[product_id] > product["available_qty"]:
            fail(f"Insufficient available stock for {product['product_name']}.", 409)
        result[product_id] = product
    return result


def get_sale(cursor, sale_id):
    cursor.execute(
        """SELECT sale_id,order_id,receipt_no,sale_date,customer_name,discount_type,
                  discount_amount,discount_id_no,payment_method,total_amount,status,user_id
           FROM sales WHERE sale_id=%s""",
        (sale_id,),
    )
    sale = cursor.fetchone()
    if not sale:
        fail("Sale not found.", 404)
    cursor.execute(
        """SELECT si.product_id,p.item_code,p.product_name,si.quantity,si.unit_price,
                  p.current_qty AS available_qty
           FROM sale_items si JOIN products p ON p.product_id=si.product_id
           WHERE si.sale_id=%s ORDER BY si.sale_item_id""",
        (sale_id,),
    )
    sale["items"] = cursor.fetchall()
    sale["subtotal"] = sum(
        (money(i["unit_price"]) * int(i["quantity"]) for i in sale["items"]),
        Decimal("0.00"),
    )
    sale["cash_received"] = None  # No corresponding column in approved schema
    sale["change_given"] = None
    return encode(sale)


def get_reservation(cursor, order_id):
    cursor.execute(
        """SELECT o.order_id,o.customer_name,o.contact_no,o.order_date,
                  o.expiry_date,o.down_payment,o.payment_method,o.fulfillment,o.status,
                  s.receipt_no AS sale_receipt
           FROM orders o LEFT JOIN sales s ON s.order_id=o.order_id
                 AND s.status='Completed'
           WHERE o.order_id=%s""",
        (order_id,),
    )
    order = cursor.fetchone()
    if not order:
        fail("Reservation not found.", 404)
    cursor.execute(
        """SELECT oi.product_id,p.item_code,p.product_name,oi.quantity,oi.unit_price
           FROM order_items oi JOIN products p ON p.product_id=oi.product_id
           WHERE oi.order_id=%s ORDER BY oi.order_item_id""",
        (order_id,),
    )
    order["items"] = cursor.fetchall()
    order["reference"] = ref("ORD", order_id)
    order["total_amount"] = sum(
        (money(i["unit_price"]) * int(i["quantity"]) for i in order["items"]),
        Decimal("0.00"),
    )
    if order["status"] == "Pending" and order["expiry_date"] < today_ph():
        order["status"] = "Expired"  # Derived; original order status is unchanged
    order["balance_due"] = (
        max(Decimal("0.00"), order["total_amount"] - money(order["down_payment"]))
        if order["status"] == "Pending" else Decimal("0.00")
    )
    return encode(order)



sales_bp = Blueprint("retailflow_sales", __name__)


def approved_discount_rate():
    """Optional finance-approved rate; disabled unless approved and configured."""
    setting = os.environ.get("CCMC_APPROVED_DISCOUNT_RATE", "").strip()
    if not setting:
        return None
    try:
        rate = Decimal(setting)
    except InvalidOperation:
        fail("Invalid approved discount configuration.", 500)
    if not rate.is_finite() or rate < 0 or rate > 1:
        fail("Invalid approved discount configuration.", 500)
    return rate


@sales_bp.get("/api/retail/config")
@auth_required
@endpoint
def configuration():
    rate = approved_discount_rate()
    return jsonify(success=True, approved_discount_rate=float(rate) if rate is not None else None)


@sales_bp.get("/api/retail/products")
@auth_required
@endpoint
def products():
    query = request.args.get("q", "").strip()[:100]
    pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Keep product retrieval simple. Reservation holds are calculated separately
            # rather than through a correlated SELECT in the product query.
            cur.execute(
                """SELECT product_id, item_code, product_name, selling_price,
                          current_qty, min_stock_level
                   FROM products
                   WHERE product_name LIKE %s OR item_code LIKE %s
                         OR barcode LIKE %s
                   ORDER BY product_name LIMIT 100""",
                (pattern, pattern, pattern),
            )
            rows = cur.fetchall()
            if rows:
                cur.execute(
                    """SELECT oi.product_id, SUM(oi.quantity) AS held_qty
                       FROM order_items oi
                       INNER JOIN orders o ON o.order_id = oi.order_id
                       WHERE o.status = 'Pending' AND o.expiry_date >= %s
                       GROUP BY oi.product_id""",
                    (today_ph(),),
                )
                holds = {int(r["product_id"]): int(r["held_qty"] or 0)
                         for r in cur.fetchall()}
                for product in rows:
                    pid = int(product["product_id"])
                    available = int(product["current_qty"]) - holds.get(pid, 0)
                    product["available_qty"] = max(0, available)
        return jsonify(success=True, products=encode(rows))
    finally:
        conn.close()


@sales_bp.get("/api/retail/sales")
@auth_required
@endpoint
def list_sales():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT sale_id,receipt_no,sale_date,customer_name,total_amount,
                          payment_method,status FROM sales
                   ORDER BY sale_date DESC,sale_id DESC LIMIT 150"""
            )
            rows = cur.fetchall()
        return jsonify(success=True, sales=encode(rows))
    finally:
        conn.close()


@sales_bp.get("/api/retail/sales/<int:sale_id>")
@auth_required
@endpoint
def sale_detail(sale_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            sale = get_sale(cur, sale_id)
        if (sale["status"] == "Unfinished"
                and sale["user_id"] != session["user_id"]
                and session["role"] != "Owner"):
            fail("You cannot edit another cashier's draft.", 403)
        return jsonify(success=True, sale=sale)
    finally:
        conn.close()


@sales_bp.post("/api/retail/sales/draft")
@auth_required
@endpoint
def save_draft():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        fail("JSON object required.")
    quantities = parse_items(data.get("items"))
    draft_id = data.get("draft_id")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            existing = None
            if draft_id is not None:
                cur.execute("SELECT sale_id,status,user_id,order_id FROM sales WHERE sale_id=%s FOR UPDATE", (draft_id,))
                existing = cur.fetchone()
                if not existing or existing["status"] != "Unfinished" or existing["order_id"] is not None:
                    fail("The saved draft is no longer editable.", 409)
                if existing["user_id"] != session["user_id"] and session["role"] != "Owner":
                    fail("This draft belongs to another cashier.", 403)
            product_rows = locked_products(cur, quantities)
            subtotal = sum((money(product_rows[pid]["selling_price"]) * q for pid, q in quantities.items()), Decimal("0.00"))
            if existing:
                sale_id = existing["sale_id"]
                cur.execute("DELETE FROM sale_items WHERE sale_id=%s", (sale_id,))
                cur.execute("""UPDATE sales SET total_amount=%s,discount_type='None',
                               discount_amount=0,discount_id_no=NULL WHERE sale_id=%s""", (subtotal, sale_id))
            else:
                cur.execute(
                    """INSERT INTO sales(user_id,order_id,receipt_no,sale_date,
                              customer_name,discount_type,discount_amount,discount_id_no,
                              payment_method,total_amount,status)
                       VALUES(%s,NULL,%s,UTC_TIMESTAMP(),NULL,'None',0,NULL,'Not paid',%s,'Unfinished')""",
                    (session["user_id"], temporary_ref(), subtotal),
                )
                sale_id = cur.lastrowid
                cur.execute("UPDATE sales SET receipt_no=%s WHERE sale_id=%s", (ref("D", sale_id), sale_id))
            for pid, qty in sorted(quantities.items()):
                row = product_rows[pid]
                cur.execute(
                    """INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost)
                       VALUES(%s,%s,%s,%s,%s)""",
                    (sale_id, pid, qty, row["selling_price"], row["cost_price"]),
                )
        conn.commit()
        return jsonify(success=True, sale_id=sale_id), 201
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@sales_bp.post("/api/retail/sales/void/<int:sale_id>")
@auth_required
@endpoint
def void_draft(sale_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT status,user_id FROM sales WHERE sale_id=%s FOR UPDATE", (sale_id,))
            draft = cur.fetchone()
            if not draft or draft["status"] != "Unfinished":
                fail("Only an unfinished sale can be voided.", 409)
            if draft["user_id"] != session["user_id"] and session["role"] != "Owner":
                fail("You cannot void another cashier's draft.", 403)
            cur.execute("UPDATE sales SET status='Voided',voided_at=UTC_TIMESTAMP() WHERE sale_id=%s", (sale_id,))
        conn.commit()
        return jsonify(success=True)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@sales_bp.post("/api/retail/sales/checkout")
@auth_required
@endpoint
def checkout():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        fail("JSON object required.")
    quantities = parse_items(data.get("items"))
    discount_type = data.get("discount_type", "None")
    if discount_type not in ("None", "Senior", "PWD"):
        fail("Invalid discount type.")
    discount_id = str(data.get("discount_id_no") or "").strip()
    customer = str(data.get("customer_name") or "").strip()
    if len(discount_id) > 50 or len(customer) > 100:
        fail("Customer name or discount ID exceeds the allowed length.")
    rate = approved_discount_rate()
    if discount_type != "None" and (rate is None or not customer or not discount_id):
        fail("A configured discount rate, customer name, and valid ID are required.")
    method = data.get("payment_method")
    gcash_reference = str(data.get("gcash_reference") or "").strip()
    if method not in ("Cash", "GCash"):
        fail("Select Cash or GCash.")
    if method == "GCash" and not gcash_reference:
        fail("Verify the GCash transaction and enter its reference.")
    if len(gcash_reference) > 100:
        fail("GCash reference is too long.")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            draft_id = data.get("draft_id")
            draft = None
            if draft_id is not None:
                cur.execute("SELECT sale_id,status,user_id,order_id FROM sales WHERE sale_id=%s FOR UPDATE", (draft_id,))
                draft = cur.fetchone()
                if not draft or draft["status"] != "Unfinished" or draft["order_id"] is not None:
                    fail("Draft was already completed or voided.", 409)
                if draft["user_id"] != session["user_id"] and session["role"] != "Owner":
                    fail("You cannot check out another cashier's draft.", 403)
            product_rows = locked_products(cur, quantities)
            subtotal = sum((money(product_rows[pid]["selling_price"]) * qty for pid, qty in quantities.items()), Decimal("0.00"))
            reduction = money(subtotal * rate) if discount_type != "None" else Decimal("0.00")
            payable = subtotal - reduction
            cash = money(data.get("cash_received")) if method == "Cash" else None
            if method == "Cash" and cash < payable:
                fail("Insufficient cash received.")
            if draft:
                sale_id = draft["sale_id"]
                cur.execute("DELETE FROM sale_items WHERE sale_id=%s", (sale_id,))
                cur.execute(
                    """UPDATE sales SET receipt_no=%s,sale_date=UTC_TIMESTAMP(),
                              customer_name=%s,discount_type=%s,discount_amount=%s,
                              discount_id_no=%s,payment_method=%s,total_amount=%s,
                              status='Completed' WHERE sale_id=%s""",
                    (ref("S", sale_id), customer or None, discount_type, reduction,
                     discount_id or None, method, payable, sale_id),
                )
            else:
                cur.execute(
                    """INSERT INTO sales(user_id,order_id,receipt_no,sale_date,
                              customer_name,discount_type,discount_amount,discount_id_no,
                              payment_method,total_amount,status)
                       VALUES(%s,NULL,%s,UTC_TIMESTAMP(),%s,%s,%s,%s,%s,%s,'Completed')""",
                    (session["user_id"], temporary_ref(), customer or None,
                     discount_type, reduction, discount_id or None, method, payable),
                )
                sale_id = cur.lastrowid
                cur.execute("UPDATE sales SET receipt_no=%s WHERE sale_id=%s", (ref("S", sale_id), sale_id))
            for pid, qty in sorted(quantities.items()):
                row = product_rows[pid]
                cur.execute(
                    """INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost)
                       VALUES(%s,%s,%s,%s,%s)""",
                    (sale_id, pid, qty, row["selling_price"], row["cost_price"]),
                )
                sale_item_id = cur.lastrowid
                cur.execute("UPDATE products SET current_qty=current_qty-%s WHERE product_id=%s", (qty, pid))
                cur.execute(
                    """INSERT INTO inventory_transactions(product_id,user_id,txn_type,
                              quantity,txn_date,remarks,sale_item_id)
                       VALUES(%s,%s,'Sale',%s,UTC_TIMESTAMP(),%s,%s)""",
                    (pid, session["user_id"], -qty, f"Sale {ref('S', sale_id)}", sale_item_id),
                )
            result = get_sale(cur, sale_id)
        conn.commit()
        return jsonify(success=True, sale=result), 201
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
