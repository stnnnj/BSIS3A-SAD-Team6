"""CCMC RetailFlow Reservations routes for the original approved SQL schema.

Reservations are date-based: an order expires AFTER its expiry_date (PHT).
The schema doesn't store cash change, GCash refs, cancellation reasons or
refund transactions. Those must be handled by an external process or later
approved migration; we do not pretend they have been persisted here.
"""
from datetime import date, timedelta
from decimal import Decimal

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



reservations_bp = Blueprint("retailflow_reservations", __name__)


def parse_expiry(value):
    try:
        expiration = date.fromisoformat(str(value))
    except (TypeError, ValueError):
        fail("Choose a valid reservation expiry date (YYYY-MM-DD).")
    if expiration < today_ph():
        fail("Expiry date must be today or later.")
    if expiration > today_ph() + timedelta(days=365):
        fail("Reservation expiry cannot exceed one year.")
    return expiration


@reservations_bp.get("/api/retail/reservations")
@auth_required
@endpoint
def reservation_list():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT o.order_id,o.customer_name,o.contact_no,o.order_date,
                          o.expiry_date,o.down_payment,o.payment_method,o.status,
                          COALESCE(SUM(oi.quantity*oi.unit_price),0) AS total_amount
                   FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.order_id
                   GROUP BY o.order_id,o.customer_name,o.contact_no,o.order_date,
                            o.expiry_date,o.down_payment,o.payment_method,o.status
                   ORDER BY o.order_id DESC LIMIT 150"""
            )
            orders = cur.fetchall()
            for order in orders:
                order["reference"] = ref("ORD", order["order_id"])
                if order["status"] == "Pending" and order["expiry_date"] < today_ph():
                    order["status"] = "Expired"
                order["balance_due"] = (
                    max(Decimal("0.00"), money(order["total_amount"]) - money(order["down_payment"]))
                    if order["status"] == "Pending" else Decimal("0.00")
                )
        return jsonify(success=True, reservations=encode(orders))
    finally:
        conn.close()


@reservations_bp.get("/api/retail/reservations/<int:order_id>")
@auth_required
@endpoint
def reservation_detail(order_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            order = get_reservation(cur, order_id)
        return jsonify(success=True, reservation=order)
    finally:
        conn.close()


@reservations_bp.post("/api/retail/reservations")
@auth_required
@endpoint
def reservation_create():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        fail("JSON object required.")
    customer = str(data.get("customer_name") or "").strip()
    contact = str(data.get("contact_no") or "").strip()
    if not customer or len(customer) > 100 or len(contact) > 20:
        fail("Customer name is required (100 characters maximum); contact number is 20 characters maximum.")
    expiry = parse_expiry(data.get("expiry_date"))
    quantities = parse_items(data.get("items"))
    down_payment = money(data.get("down_payment", 0))
    payment_method = data.get("payment_method")
    gcash_reference = str(data.get("gcash_reference") or "").strip()
    if payment_method not in ("Cash", "GCash") or down_payment < 0:
        fail("Select a valid deposit method and non-negative down payment.")
    if down_payment > 0 and data.get("deposit_confirmed") is not True:
        fail("Confirm the deposit was actually received before recording it.")
    if payment_method == "GCash" and down_payment > 0 and not gcash_reference:
        fail("Verify the GCash deposit and enter its reference.")
    if len(gcash_reference) > 100:
        fail("GCash reference too long.")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            rows = locked_products(cur, quantities)
            total = sum((money(rows[pid]["selling_price"]) * q for pid, q in quantities.items()), Decimal("0.00"))
            if down_payment > total:
                fail("Down payment cannot exceed reservation total.")
            cur.execute(
                """INSERT INTO orders(customer_name,contact_no,order_date,expiry_date,
                          down_payment,payment_method,fulfillment,status)
                   VALUES(%s,%s,UTC_TIMESTAMP(),%s,%s,%s,'Pickup','Pending')""",
                (customer, contact or None, expiry, down_payment, payment_method),
            )
            order_id = cur.lastrowid
            for pid, qty in sorted(quantities.items()):
                cur.execute(
                    """INSERT INTO order_items(order_id,product_id,quantity,unit_price)
                       VALUES(%s,%s,%s,%s)""",
                    (order_id, pid, qty, rows[pid]["selling_price"]),
                )
        conn.commit()
        return jsonify(success=True, order_id=order_id, reference=ref("ORD", order_id)), 201
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@reservations_bp.post("/api/retail/reservations/<int:order_id>/convert")
@auth_required
@endpoint
def reservation_convert(order_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        fail("JSON object required.")
    method = data.get("payment_method")
    gcash_reference = str(data.get("gcash_reference") or "").strip()
    if method not in ("Cash", "GCash"):
        fail("Choose Cash or GCash.")
    if len(gcash_reference) > 100:
        fail("GCash reference too long.")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT order_id,status,expiry_date,customer_name,down_payment,
                          payment_method FROM orders WHERE order_id=%s FOR UPDATE""",
                (order_id,),
            )
            order = cur.fetchone()
            if not order:
                fail("Reservation not found.", 404)
            if order["status"] != "Pending":
                fail("This reservation was already closed.", 409)
            if order["expiry_date"] < today_ph():
                fail("Reservation has expired.", 409)
            cur.execute(
                """SELECT product_id,quantity,unit_price FROM order_items
                   WHERE order_id=%s""",
                (order_id,),
            )
            items = cur.fetchall()
            quantities = {}
            for item in items:
                quantities[item["product_id"]] = quantities.get(item["product_id"], 0) + int(item["quantity"])
            if not quantities:
                fail("Reservation has no products.", 409)
            stock = locked_products(cur, quantities, excluded_order=order_id)
            total = sum((money(item["unit_price"]) * int(item["quantity"]) for item in items), Decimal("0.00"))
            balance = max(Decimal("0.00"), total - money(order["down_payment"]))
            cash = money(data.get("cash_received")) if method == "Cash" else None
            if method == "Cash" and cash < balance:
                fail("Cash received does not cover the remaining balance.")
            if method == "GCash" and balance > 0 and not gcash_reference:
                fail("Verify the GCash balance transfer and enter its reference.")
            # The approved schema stores only a combined payment-method label.
            combined_method = method if money(order["down_payment"]) == 0 else (
                order["payment_method"] if order["payment_method"] == method
                else f"{order['payment_method']} + {method}"
            )
            cur.execute(
                """INSERT INTO sales(user_id,order_id,receipt_no,sale_date,customer_name,
                          discount_type,discount_amount,discount_id_no,payment_method,
                          total_amount,status)
                   VALUES(%s,%s,%s,UTC_TIMESTAMP(),%s,'None',0,NULL,%s,%s,'Completed')""",
                (session["user_id"], order_id, temporary_ref(), order["customer_name"],
                 combined_method, total),
            )
            sale_id = cur.lastrowid
            receipt = ref("S", sale_id)
            cur.execute("UPDATE sales SET receipt_no=%s WHERE sale_id=%s", (receipt, sale_id))
            for item in items:
                pid = item["product_id"]
                qty = int(item["quantity"])
                cur.execute(
                    """INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost)
                       VALUES(%s,%s,%s,%s,%s)""",
                    (sale_id, pid, qty, item["unit_price"], stock[pid]["cost_price"]),
                )
                sale_item_id = cur.lastrowid
                cur.execute("UPDATE products SET current_qty=current_qty-%s WHERE product_id=%s", (qty, pid))
                cur.execute(
                    """INSERT INTO inventory_transactions(product_id,user_id,txn_type,
                              quantity,txn_date,remarks,sale_item_id)
                       VALUES(%s,%s,'Sale',%s,UTC_TIMESTAMP(),%s,%s)""",
                    (pid, session["user_id"], -qty,
                     f"Reservation {ref('ORD', order_id)} to sale {receipt}", sale_item_id),
                )
            cur.execute("UPDATE orders SET status='Converted' WHERE order_id=%s", (order_id,))
        conn.commit()
        return jsonify(success=True, sale_id=sale_id, receipt_no=receipt), 201
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@reservations_bp.post("/api/retail/reservations/<int:order_id>/cancel")
@auth_required
@endpoint
def reservation_cancel(order_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        fail("JSON object required.")
    reason = str(data.get("reason") or "").strip()
    method = data.get("refund_method")
    if not reason or len(reason) > 1000 or method not in ("Cash", "GCash"):
        fail("Provide cancellation reason and refund method.")
    if data.get("verified") is not True:
        fail("Verify the customer identity and deposit.")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT order_id,status,down_payment FROM orders WHERE order_id=%s FOR UPDATE",
                (order_id,),
            )
            order = cur.fetchone()
            if not order:
                fail("Reservation not found.", 404)
            if order["status"] != "Pending":
                fail("Only a pending reservation can be cancelled.", 409)
            refund = money(order["down_payment"])
            if refund > 0 and data.get("refund_confirmed") is not True:
                fail("Confirm the deposit refund was completed outside RetailFlow first.")
            cur.execute("UPDATE orders SET status='Cancelled' WHERE order_id=%s", (order_id,))
        conn.commit()
        return jsonify(
            success=True,
            refund_amount=float(refund),
            message="Reservation cancelled. Stock hold released. Refund details are not stored in the approved schema.",
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
