
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from flask import Blueprint, current_app, jsonify, request, session
from db import get_db_connection

financial_bp = Blueprint("financial", __name__, url_prefix="/api/financial")
CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def amount(value):
    """Convert a database number to decimal pesos, rounded to cents."""
    return Decimal(str(0 if value is None else value)).quantize(
        CENT, rounding=ROUND_HALF_UP
    )


def to_number(value):
    """Convert decimal pesos to a number suitable for the existing JS."""
    return float(amount(value))


def net_unit_price(unit_price, sale_total, gross_total):
    """Allocate the paid receipt total proportionally to its original items."""
    gross = Decimal(str(gross_total or 0))
    if gross <= 0:
        return ZERO
    return amount(Decimal(str(unit_price)) * Decimal(str(sale_total or 0)) / gross)


def parse_date(raw, label):
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be in YYYY-MM-DD format.") from exc


@financial_bp.before_request
def require_owner():
    if "user_id" not in session:
        return jsonify(success=False, message="Authentication required."), 401
    if session.get("role") != "Owner":
        return jsonify(success=False, message="Owner access required."), 403


@financial_bp.get("/summary")
def summary():
    try:
        start = parse_date(request.args.get("start_date"), "start_date")
        end = parse_date(request.args.get("end_date"), "end_date")
        payment = (request.args.get("payment") or "").strip()
        category = (request.args.get("category") or "").strip()
        if start and end and start > end:
            raise ValueError("Start date must not be later than end date.")
        if len(payment) > 30 or len(category) > 100:
            raise ValueError("A filter value is too long.")
    except ValueError as exc:
        return jsonify(success=False, message=str(exc)), 400

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT category_name FROM categories ORDER BY category_name")
            categories = [r["category_name"] for r in cursor.fetchall()]
            cursor.execute("""
                SELECT DISTINCT payment_method
                FROM sales
                WHERE status = 'Completed'
                ORDER BY payment_method
            """)
            recorded_payments = [
                r["payment_method"] for r in cursor.fetchall()
                if r["payment_method"]
            ]
            # Show supported checkout methods even when there are no
            # matching completed sales yet. Never create sample records.
            payments = ["Cash", "GCash"] + [
                method for method in recorded_payments
                if method not in ("Cash", "GCash")
            ]

            sale_where = ["s.status = 'Completed'"]
            sale_args = []
            if start:
                sale_where.append("s.sale_date >= %s")
                sale_args.append(start)
            if end:
                sale_where.append("s.sale_date < DATE_ADD(%s, INTERVAL 1 DAY)")
                sale_args.append(end)
            if payment:
                sale_where.append("s.payment_method = %s")
                sale_args.append(payment)

            cursor.execute(f"""
                SELECT s.receipt_no, DATE(s.sale_date) AS activity_date,
                       s.payment_method, s.total_amount, si.quantity,
                       si.unit_price, si.unit_cost, p.product_name,
                       c.category_name,
                       (SELECT COALESCE(SUM(x.quantity * x.unit_price), 0)
                          FROM sale_items x WHERE x.sale_id = s.sale_id) AS sale_gross
                FROM sales s
                JOIN sale_items si ON si.sale_id = s.sale_id
                JOIN products p ON p.product_id = si.product_id
                JOIN categories c ON c.category_id = p.category_id
                WHERE {' AND '.join(sale_where)}
                ORDER BY s.sale_date DESC, si.sale_item_id
            """, sale_args)
            sale_rows = cursor.fetchall()

            return_where = ["s.status = 'Completed'"]
            return_args = []
            if start:
                return_where.append("r.return_date >= %s")
                return_args.append(start)
            if end:
                return_where.append("r.return_date <= %s")
                return_args.append(end)
            if payment:
                # Original schema does not store refund method on returns.
                # This filter uses the payment method of the linked sale.
                return_where.append("s.payment_method = %s")
                return_args.append(payment)

            cursor.execute(f"""
                SELECT r.return_id, r.return_date AS activity_date,
                       r.quantity, r.refund_amount, s.payment_method,
                       si.unit_cost, p.product_name, c.category_name,
                       EXISTS (
                           SELECT 1 FROM inventory_transactions it
                           WHERE it.return_id = r.return_id
                             AND it.quantity > 0
                             AND LOWER(it.txn_type) = 'return'
                       ) AS restocked
                FROM returns r
                JOIN sale_items si ON si.sale_item_id = r.sale_item_id
                JOIN sales s ON s.sale_id = si.sale_id
                JOIN products p ON p.product_id = si.product_id
                JOIN categories c ON c.category_id = p.category_id
                WHERE {' AND '.join(return_where)}
                ORDER BY r.return_date DESC, r.return_id DESC
            """, return_args)
            return_rows = cursor.fetchall()

        rows = []
        completed = original_cogs = refunds = reversal = ZERO

        for item in sale_rows:
            if category and item["category_name"] != category:
                continue
            qty = int(item["quantity"])
            net = net_unit_price(item["unit_price"], item["total_amount"], item["sale_gross"])
            cost = amount(item["unit_cost"])
            completed += net * qty
            original_cogs += cost * qty
            rows.append({
                "source": item["receipt_no"],
                "product": item["product_name"],
                "category": item["category_name"],
                "payment": item["payment_method"],
                "date": str(item["activity_date"]),
                "netPrice": to_number(net), "cost": to_number(cost),
                "qty": qty, "kind": "sale",
                "profit": to_number((net - cost) * qty),
            })

        for item in return_rows:
            if category and item["category_name"] != category:
                continue
            qty = int(item["quantity"])
            refund_total = amount(item["refund_amount"])
            net = amount(refund_total / qty) if qty else ZERO
            # Restocked items reverse original COGS; other refunds do not.
            cost = amount(item["unit_cost"]) if item["restocked"] else ZERO
            refunds += refund_total
            reversal += cost * qty
            rows.append({
                "source": f"R-{item['return_id']}",
                "product": item["product_name"],
                "category": item["category_name"],
                "payment": item["payment_method"],
                "date": str(item["activity_date"]),
                "netPrice": to_number(net), "cost": to_number(cost),
                "qty": -qty, "kind": "return",
                "profit": to_number(-refund_total + cost * qty),
            })

        completed = amount(completed)
        original_cogs = amount(original_cogs)
        refunds = amount(refunds)
        reversal = amount(reversal)
        net_sales = amount(completed - refunds)
        net_cogs = amount(original_cogs - reversal)
        gross_profit = amount(net_sales - net_cogs)

        return jsonify(
            success=True,
            rows=rows,
            filters={"categories": categories, "payments": payments},
            totals={
                "completed": to_number(completed),
                "originalCost": to_number(original_cogs),
                "refundAmount": to_number(refunds),
                "costReversal": to_number(reversal),
                "netSales": to_number(net_sales),
                "netCogs": to_number(net_cogs),
                "grossProfit": to_number(gross_profit),
            },
        )
    except Exception:
        current_app.logger.exception("Financial Analytics query failed")
        return jsonify(success=False, message="Unable to load Financial Analytics from the database."), 500
    finally:
        if conn is not None:
            conn.close()
