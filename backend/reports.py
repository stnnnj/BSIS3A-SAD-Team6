"""Owner Reports: summary, sales, reservations, returns, and stock reports.

Register this module once in backend/app.py:
    from reports import reports_bp
    app.register_blueprint(reports_bp)

Uses existing db.py, users login session, and 10-table schema.
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from functools import wraps
import logging

from flask import Blueprint, jsonify, request, session
from db import get_db_connection

reports_bp = Blueprint("owner_reports", __name__)
logger = logging.getLogger(__name__)
MAX_REPORT_ROWS = 5000

def owner_only(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify(success=False, message="Please sign in."), 401
        if session.get("role") != "Owner":
            return jsonify(success=False, message="Owner access required."), 403
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


def date_window():
    """Validated inclusive calendar dates, converted to index-friendly bounds."""
    today = date.today()
    raw_start = request.args.get("from", (today - timedelta(days=29)).isoformat())
    raw_end = request.args.get("to", today.isoformat())
    try:
        start = date.fromisoformat(raw_start)
        end = date.fromisoformat(raw_end)
        if start > end or (end - start).days > 366:
            raise ValueError("Invalid date range")
        return (datetime.combine(start, time.min),
                datetime.combine(end + timedelta(days=1), time.min), start, end)
    except (TypeError, ValueError, OverflowError):
        return None


@reports_bp.after_request
def prevent_cache(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@reports_bp.get("/api/owner/reports/summary")
@owner_only
def reports_summary():
    window = date_window()
    if window is None:
        return fail("Choose a date range of up to 367 days.")
    start, stop, _, _ = window
    try:
        sales = one_query("""
            SELECT COUNT(*) AS completed_sales,
                   COALESCE(SUM(total_amount), 0) AS gross_sales
            FROM sales WHERE status = 'Completed'
              AND sale_date >= %s AND sale_date < %s
        """, (start, stop))
        refunds = one_query("""
            SELECT COALESCE(SUM(refund_amount), 0) AS refunds
            FROM returns WHERE return_date >= %s AND return_date < %s
        """, (start, stop))
        movements = one_query("""
            SELECT COUNT(*) AS inventory_movements
            FROM inventory_transactions WHERE txn_date >= %s AND txn_date < %s
        """, (start, stop))
        trend = rows_query("""
            SELECT DATE(sale_date) AS day, COUNT(*) AS sales_count,
                   COALESCE(SUM(total_amount),0) AS total_sales
            FROM sales WHERE status='Completed'
              AND sale_date >= %s AND sale_date < %s
            GROUP BY DATE(sale_date) ORDER BY day DESC LIMIT 14
        """, (start, stop))
        return jsonify(success=True, stats={
            "completed_sales": sales["completed_sales"],
            "gross_sales": sales["gross_sales"],
            "recorded_refunds": refunds["refunds"],
            "inventory_movements": movements["inventory_movements"]
        }, trend=list(reversed(trend)))
    except Exception:
        logger.exception("Report summary failed")
        return fail("Unable to load report summary.", 503)


REPORTS = {
    "sales": """
        SELECT s.sale_date AS date, s.receipt_no, s.customer_name,
               s.payment_method, s.status, s.total_amount
        FROM sales s WHERE s.sale_date >= %s AND s.sale_date < %s
        ORDER BY s.sale_date DESC, s.sale_id DESC LIMIT %s
    """,
    "reservations": """
        SELECT o.order_date AS date, o.order_id, o.customer_name,
               o.expiry_date, o.down_payment, o.payment_method, o.status
        FROM orders o WHERE o.order_date >= %s AND o.order_date < %s
        ORDER BY o.order_date DESC, o.order_id DESC LIMIT %s
    """,
    "returns": """
        SELECT r.return_date AS date, r.original_receipt_no,
               p.product_name, r.quantity, r.refund_amount, r.reason
        FROM returns r
        JOIN sale_items si ON si.sale_item_id = r.sale_item_id
        JOIN products p ON p.product_id = si.product_id
        WHERE r.return_date >= %s AND r.return_date < %s
        ORDER BY r.return_date DESC, r.return_id DESC LIMIT %s
    """,
    "inventory": """
        SELECT t.txn_date AS date, p.item_code, p.product_name,
               t.txn_type, t.quantity, u.name AS performed_by, t.remarks
        FROM inventory_transactions t
        JOIN products p ON p.product_id = t.product_id
        JOIN users u ON u.user_id = t.user_id
        WHERE t.txn_date >= %s AND t.txn_date < %s
        ORDER BY t.txn_date DESC, t.txn_id DESC LIMIT %s
    """,
    "low-stock": """
        SELECT p.item_code, p.product_name, c.category_name,
               p.current_qty, p.min_stock_level,
               CASE WHEN p.current_qty = 0 THEN 'Out of Stock'
                    ELSE 'Low Stock' END AS status
        FROM products p JOIN categories c ON c.category_id = p.category_id
        WHERE p.current_qty <= p.min_stock_level
        ORDER BY p.current_qty, p.product_name LIMIT %s
    """
}


@reports_bp.get("/api/owner/reports/data")
@owner_only
def reports_data():
    report_type = request.args.get("type", "sales")
    if report_type not in REPORTS:
        return fail("Unknown report type.")
    if report_type == "low-stock":
        params = (MAX_REPORT_ROWS + 1,)
    else:
        window = date_window()
        if window is None:
            return fail("Choose a date range of up to 367 days.")
        start, stop, _, _ = window
        params = (start, stop, MAX_REPORT_ROWS + 1)
    try:
        rows = rows_query(REPORTS[report_type], params)
        return jsonify(success=True, rows=rows[:MAX_REPORT_ROWS],
                       truncated=len(rows) > MAX_REPORT_ROWS, report_type=report_type)
    except Exception:
        logger.exception("Report data failed: %s", report_type)
        return fail("Unable to load the selected report.", 503)
