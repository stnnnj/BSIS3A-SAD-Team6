"""Shared Inventory: Staff/Owner viewing; Owner-only manual adjustments.

Register this module once in backend/app.py:
    from inventory import inventory_bp
    app.register_blueprint(inventory_bp)

Uses existing db.py, users login session, and 10-table schema.
"""
from datetime import date, datetime
from decimal import Decimal
from functools import wraps
import logging

from flask import Blueprint, jsonify, request, session
from db import get_db_connection

inventory_bp = Blueprint("owner_inventory", __name__)
logger = logging.getLogger(__name__)

def owner_only(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify(success=False, message="Please sign in."), 401
        if session.get("role") != "Owner":
            return jsonify(success=False, message="Owner access required."), 403
        return func(*args, **kwargs)
    return wrapper


def inventory_reader(func):
    """Both authenticated roles can view stock and movement history."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify(success=False, message="Please sign in."), 401
        if session.get("role") not in ("Owner", "Staff"):
            return jsonify(success=False, message="Inventory access denied."), 403
        return func(*args, **kwargs)
    return wrapper


def fail(message, status=400):
    return jsonify(success=False, message=message), status


def serialize_record(record):
    """Keep TiDB dates as ISO strings and decimal money values exact in JSON."""
    if record is None:
        return None
    return {
        key: (value.isoformat(sep=" ") if isinstance(value, datetime)
              else value.isoformat() if isinstance(value, date)
              else str(value) if isinstance(value, Decimal)
              else value)
        for key, value in record.items()
    }


def rows_query(sql, params=()):
    """One read-only query; connect and close on each request."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(sql, params)
            return [serialize_record(record) for record in cursor.fetchall()]
    finally:
        conn.close()


def one_query(sql, params=()):
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(sql, params)
            return serialize_record(cursor.fetchone())
    finally:
        conn.close()


@inventory_bp.after_request
def prevent_cache(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@inventory_bp.get("/api/inventory/overview")
@inventory_bp.get("/api/owner/inventory/overview")  # Compatibility with existing Owner links
@inventory_reader
def inventory_overview():
    """Current stock, thresholds and reference product details."""
    try:
        products = rows_query("""
            SELECT p.product_id, p.item_code, p.barcode, p.product_name,
                   p.brand, p.size, p.color, p.selling_price,
                   p.current_qty, p.min_stock_level,
                   c.category_name, s.supplier_name,
                   CASE WHEN p.current_qty = 0 THEN 'Out of Stock'
                        WHEN p.current_qty <= p.min_stock_level THEN 'Low Stock'
                        ELSE 'In Stock' END AS stock_status
            FROM products p
            LEFT JOIN categories c ON c.category_id = p.category_id
            LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id
            ORDER BY p.product_name, p.item_code
        """)
        stats = {
            "products": len(products),
            "units": sum(int(p["current_qty"] or 0) for p in products),
            "low_stock": sum(p["stock_status"] == "Low Stock" for p in products),
            "out_of_stock": sum(p["stock_status"] == "Out of Stock" for p in products),
        }
        return jsonify(success=True, products=products, stats=stats)
    except Exception:
        logger.exception("Inventory overview failed")
        return fail("Unable to load inventory. Check your database connection.", 503)


@inventory_bp.get("/api/inventory/transactions")
@inventory_bp.get("/api/owner/inventory/transactions")  # Compatibility with existing Owner links
@inventory_reader
def inventory_transactions():
    try:
        raw_limit = request.args.get("limit", "50")
        limit = int(raw_limit)
        if limit < 1 or limit > 200:
            return fail("Limit must be between 1 and 200.")
        transactions = rows_query("""
            SELECT t.txn_id, t.txn_date, t.txn_type, t.quantity,
                   t.remarks, p.item_code, p.product_name, u.name AS performed_by
            FROM inventory_transactions t
            JOIN products p ON p.product_id = t.product_id
            JOIN users u ON u.user_id = t.user_id
            ORDER BY t.txn_date DESC, t.txn_id DESC
            LIMIT %s
        """, (limit,))
        return jsonify(success=True, rows=transactions)
    except (TypeError, ValueError):
        return fail("Invalid transaction limit.")
    except Exception:
        logger.exception("Inventory log failed")
        return fail("Unable to load inventory history.", 503)


@inventory_bp.post("/api/owner/inventory/adjustments")
@owner_only
def inventory_adjustment():
    """Update stock and create an audit log in the SAME transaction."""
    if not request.is_json:
        return fail("JSON request body required.", 415)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return fail("Invalid request data.")
    try:
        if isinstance(payload.get("product_id"), bool) or isinstance(payload.get("quantity"), bool):
            raise ValueError()
        product_id = int(payload.get("product_id"))
        quantity = int(payload.get("quantity"))
        if (str(payload.get("product_id")).strip() != str(product_id) or
                str(payload.get("quantity")).strip() != str(quantity)):
            raise ValueError()
    except (ValueError, TypeError):
        return fail("Select a product and enter a whole-number quantity.")
    direction = payload.get("direction")
    remarks = payload.get("remarks")
    if product_id < 1 or not 1 <= quantity <= 100000:
        return fail("Quantity must be between 1 and 100,000.")
    if direction not in ("in", "out"):
        return fail("Choose Stock In or Stock Out.")
    if not isinstance(remarks, str) or len(remarks.strip()) < 3 or len(remarks.strip()) > 500:
        return fail("Enter a reason between 3 and 500 characters.")
    delta = quantity if direction == "in" else -quantity
    txn_type = "Manual In" if direction == "in" else "Manual Out"
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT current_qty FROM products WHERE product_id = %s FOR UPDATE", (product_id,))
            product = cursor.fetchone()
            if not product:
                conn.rollback()
                return fail("Product not found.", 404)
            new_quantity = int(product["current_qty"]) + delta
            if new_quantity < 0:
                conn.rollback()
                return fail("Not enough available stock for this adjustment.", 409)
            cursor.execute("UPDATE products SET current_qty = %s WHERE product_id = %s",
                           (new_quantity, product_id))
            cursor.execute("""
                INSERT INTO inventory_transactions
                    (product_id, user_id, txn_type, quantity, txn_date, remarks)
                VALUES (%s, %s, %s, %s, NOW(), %s)
            """, (product_id, session["user_id"], txn_type, quantity, remarks.strip()))
            transaction_id = cursor.lastrowid
        conn.commit()
        return jsonify(success=True, message="Stock saved and logged.",
                       transaction_id=transaction_id, current_qty=new_quantity), 201
    except Exception:
        if conn is not None:
            conn.rollback()
        logger.exception("Manual stock adjustment failed")
        return fail("Stock adjustment could not be saved.", 503)
    finally:
        if conn is not None:
            conn.close()


