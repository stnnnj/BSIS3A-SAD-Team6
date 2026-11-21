
"""
CCMC RetailFlow – Owner Dashboard Backend

Endpoint:
GET /api/owner/dashboard

Uses the existing TiDB Cloud database.
Owner-only access.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from flask import (
    Blueprint,
    current_app,
    jsonify,
    session
)

from db import get_db_connection


# ==========================================
# BLUEPRINT CONFIGURATION
# ==========================================

owner_dashboard_bp = Blueprint(
    "owner_dashboard",
    __name__
)

PH_TIMEZONE = timezone(timedelta(hours=8))

# Keep this consistent with the Sales module.
COMPLETED_STATUS = "completed"


# ==========================================
# OWNER DASHBOARD API
# ==========================================

@owner_dashboard_bp.route(
    "/api/owner/dashboard",
    methods=["GET"]
)
def get_owner_dashboard():

    # ======================================
    # 1. AUTHENTICATION
    # ======================================

    if not session.get("user_id"):
        return jsonify({
            "success": False,
            "message": "Authentication required"
        }), 401

    # ======================================
    # 2. OWNER AUTHORIZATION
    # ======================================

    if session.get("role") != "Owner":
        return jsonify({
            "success": False,
            "message": "Owner access required"
        }), 403

    connection = None

    try:
        connection = get_db_connection()

        today = datetime.now(PH_TIMEZONE).date()
        tomorrow = today + timedelta(days=1)
        week_start = today - timedelta(days=6)

        with connection.cursor() as cursor:

            # Use Philippine time for TIMESTAMP
            # calculations on this connection.
            cursor.execute(
                "SET time_zone = '+08:00'"
            )

            # ==================================
            # 3. TOTAL SALES TODAY
            # ==================================

            cursor.execute("""
                SELECT
                    COUNT(*) AS sale_count,
                    COALESCE(
                        SUM(total_amount), 0
                    ) AS total_sales
                FROM sales
                WHERE LOWER(status) = %s
                  AND sale_date >= %s
                  AND sale_date < %s
            """, (
                COMPLETED_STATUS,
                today,
                tomorrow
            ))

            sales_result = cursor.fetchone()

            total_sales = Decimal(
                sales_result["total_sales"] or 0
            )

            # ==================================
            # 4. RECORDED REFUNDS TODAY
            # ==================================

            cursor.execute("""
                SELECT
                    COALESCE(
                        SUM(refund_amount), 0
                    ) AS total_refunds
                FROM returns
                WHERE return_date = %s
            """, (today,))

            refund_result = cursor.fetchone()

            refunds_today = Decimal(
                refund_result["total_refunds"] or 0
            )

            # ==================================
            # 5. NET SALES TODAY
            # ==================================

            net_sales = total_sales - refunds_today

            # ==================================
            # 6. COST OF GOODS SOLD TODAY
            # ==================================

            cursor.execute("""
                SELECT
                    COALESCE(
                        SUM(
                            si.quantity * si.unit_cost
                        ), 0
                    ) AS total_cost
                FROM sale_items AS si
                INNER JOIN sales AS s
                    ON si.sale_id = s.sale_id
                WHERE LOWER(s.status) = %s
                  AND s.sale_date >= %s
                  AND s.sale_date < %s
            """, (
                COMPLETED_STATUS,
                today,
                tomorrow
            ))

            cost_result = cursor.fetchone()

            total_cost = Decimal(
                cost_result["total_cost"] or 0
            )

            # Gross profit on today's completed
            # sales before refunds and expenses.
            gross_profit = total_sales - total_cost

            # ==================================
            # 7. TOTAL STOCK AND LOW STOCK
            # ==================================

            cursor.execute("""
                SELECT
                    COALESCE(
                        SUM(current_qty), 0
                    ) AS total_stock,

                    COUNT(
                        CASE
                            WHEN current_qty <=
                                 min_stock_level
                            THEN 1
                        END
                    ) AS low_stock_products

                FROM products
            """)

            inventory_result = cursor.fetchone()

            total_stock = int(
                inventory_result["total_stock"] or 0
            )

            low_stock_products = int(
                inventory_result["low_stock_products"] or 0
            )

            # ==================================
            # 8. LOW-STOCK ALERTS
            # ==================================

            cursor.execute("""
                SELECT
                    product_id,
                    product_name,
                    current_qty,
                    min_stock_level
                FROM products
                WHERE current_qty <= min_stock_level
                ORDER BY current_qty ASC
                LIMIT 5
            """)

            inventory_alerts = []

            for row in cursor.fetchall():

                inventory_alerts.append({
                    "product_id": row["product_id"],
                    "message": (
                        f"{row['product_name']}: "
                        f"{row['current_qty']} unit(s) "
                        f"remaining "
                        f"(minimum: "
                        f"{row['min_stock_level']})"
                    )
                })

            # ==================================
            # 9. RECENT SALES
            # ==================================

            cursor.execute("""
                SELECT
                    sale_id,
                    receipt_no,
                    sale_date,
                    total_amount,
                    status
                FROM sales
                ORDER BY sale_date DESC, sale_id DESC
                LIMIT 5
            """)

            recent_sales = []

            for row in cursor.fetchall():

                sale_date = row["sale_date"]

                recent_sales.append({
                    "sale_id": row["sale_id"],
                    "receipt_no": row["receipt_no"],
                    "sale_date": (
                        sale_date.isoformat()
                        if sale_date
                        else None
                    ),
                    "total_amount": float(
                        row["total_amount"]
                    ),
                    "status": row["status"]
                })

            # ==================================
            # 10. SALES TREND – LAST 7 DAYS
            # ==================================

            cursor.execute("""
                SELECT
                    DATE(sale_date) AS sale_day,
                    COALESCE(
                        SUM(total_amount), 0
                    ) AS total_sales
                FROM sales
                WHERE LOWER(status) = %s
                  AND sale_date >= %s
                  AND sale_date < %s
                GROUP BY DATE(sale_date)
                ORDER BY sale_day ASC
            """, (
                COMPLETED_STATUS,
                week_start,
                tomorrow
            ))

            sales_by_day = {}

            for row in cursor.fetchall():

                day = row["sale_day"]

                if hasattr(day, "isoformat"):
                    day = day.isoformat()
                else:
                    day = str(day)

                sales_by_day[day] = float(
                    row["total_sales"] or 0
                )

            sales_trend = []

            for day_offset in range(7):

                current_day = (
                    week_start +
                    timedelta(days=day_offset)
                )

                day_key = current_day.isoformat()

                sales_trend.append({
                    "date": day_key,
                    "total_sales": sales_by_day.get(
                        day_key, 0.0
                    )
                })

        # ======================================
        # 11. SUCCESSFUL API RESPONSE
        # ======================================

        return jsonify({
            "success": True,
            "data": {
                "summary": {
                    "total_sales_today": float(
                        total_sales
                    ),
                    "net_sales_today": float(
                        net_sales
                    ),
                    "total_stock": total_stock,
                    "low_stock_products": (
                        low_stock_products
                    ),
                    "gross_profit_today": float(
                        gross_profit
                    ),
                    "refunds_today": float(
                        refunds_today
                    )
                },
                "recent_sales": recent_sales,
                "inventory_alerts": inventory_alerts,
                "sales_trend": sales_trend
            }
        }), 200

    except Exception:

        current_app.logger.exception(
            "Owner Dashboard query failed"
        )

        return jsonify({
            "success": False,
            "message": (
                "Unable to retrieve Owner "
                "Dashboard data"
            )
        }), 500

    finally:

        if connection:
            connection.close()
