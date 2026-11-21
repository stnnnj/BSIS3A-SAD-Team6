
"""
CCMC RetailFlow – Staff Dashboard Backend

GET /api/staff/dashboard

Uses the existing CCMC RetailFlow database schema.
"""

from datetime import datetime, timedelta, timezone

from flask import (
    Blueprint,
    current_app,
    jsonify,
    session
)

from db import get_db_connection


staff_dashboard_bp = Blueprint(
    "staff_dashboard",
    __name__
)

PH_TIMEZONE = timezone(timedelta(hours=8))


@staff_dashboard_bp.route(
    "/api/staff/dashboard",
    methods=["GET"]
)
def get_staff_dashboard():

    # ======================================
    # 1. AUTHENTICATION AND AUTHORIZATION
    # ======================================

    if not session.get("user_id"):
        return jsonify({
            "success": False,
            "message": "Authentication required"
        }), 401

    if session.get("role") not in ("Staff", "Owner"):
        return jsonify({
            "success": False,
            "message": "Access denied"
        }), 403

    connection = None

    try:
        connection = get_db_connection()

        today = datetime.now(PH_TIMEZONE).date()
        tomorrow = today + timedelta(days=1)

        # Match TIMESTAMP interpretation to
        # the Philippine local timezone.
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+08:00'")

            # ==================================
            # 2. COMPLETED SALES TODAY
            # ==================================

            cursor.execute("""
                SELECT
                    COUNT(*) AS completed_sales,
                    COALESCE(
                        SUM(total_amount), 0
                    ) AS collected_amount
                FROM sales
                WHERE LOWER(status) = 'completed'
                  AND sale_date >= %s
                  AND sale_date < %s
            """, (today, tomorrow))

            sales_summary = cursor.fetchone()

            # ==================================
            # 3. UNFINISHED SALES
            # ==================================

            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM sales
                WHERE LOWER(status) = 'unfinished'
            """)

            unfinished_sales = cursor.fetchone()["total"]

            # ==================================
            # 4. OPEN RESERVATIONS
            # ==================================

            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM orders
                WHERE LOWER(status) = 'reserved'
                  AND expiry_date >= %s
            """, (today,))

            open_reservations = cursor.fetchone()["total"]

            # ==================================
            # 5. EXPIRING RESERVATIONS
            # ==================================

            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM orders
                WHERE LOWER(status) = 'reserved'
                  AND expiry_date BETWEEN %s AND %s
            """, (today, tomorrow))

            expiring_reservations = (
                cursor.fetchone()["total"]
            )

            # ==================================
            # 6. LOW-STOCK PRODUCTS
            # ==================================

            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM products
                WHERE current_qty <= min_stock_level
            """)

            low_stock_products = cursor.fetchone()["total"]

            # ==================================
            # 7. RECENT SALES
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
                recent_sales.append({
                    "sale_id": row["sale_id"],
                    "reference_no": row["receipt_no"],
                    "created_at": (
                        row["sale_date"].isoformat()
                        if row["sale_date"]
                        else None
                    ),
                    "total_amount": float(
                        row["total_amount"]
                    ),
                    "status": row["status"]
                })

            # ==================================
            # 8. RESERVATION ALERTS
            # ==================================

            cursor.execute("""
                SELECT
                    order_id,
                    customer_name,
                    expiry_date
                FROM orders
                WHERE LOWER(status) = 'reserved'
                  AND expiry_date BETWEEN %s AND %s
                ORDER BY expiry_date ASC
                LIMIT 5
            """, (today, tomorrow))

            reservation_alerts = []

            for row in cursor.fetchall():
                reservation_alerts.append({
                    "message": (
                        f"Reservation #{row['order_id']} "
                        f"for {row['customer_name']} "
                        f"expires on "
                        f"{row['expiry_date']}"
                    )
                })

            # ==================================
            # 9. INVENTORY ALERTS
            # ==================================

            cursor.execute("""
                SELECT
                    product_id,
                    product_name,
                    current_qty
                FROM products
                WHERE current_qty <= min_stock_level
                ORDER BY current_qty ASC
                LIMIT 5
            """)

            inventory_alerts = []

            for row in cursor.fetchall():
                inventory_alerts.append({
                    "message": (
                        f"{row['product_name']}: "
                        f"{row['current_qty']} "
                        f"unit(s) remaining"
                    )
                })

        # ======================================
        # 10. API RESPONSE
        # ======================================

        return jsonify({
            "success": True,
            "data": {
                "summary": {
                    "completed_sales": int(
                        sales_summary["completed_sales"]
                    ),
                    "collected_amount": float(
                        sales_summary["collected_amount"]
                    ),
                    "open_reservations": int(
                        open_reservations
                    ),
                    "expiring_reservations": int(
                        expiring_reservations
                    ),
                    "unfinished_sales": int(
                        unfinished_sales
                    ),
                    "low_stock_products": int(
                        low_stock_products
                    )
                },
                "recent_sales": recent_sales,
                "reservation_alerts": reservation_alerts,
                "inventory_alerts": inventory_alerts
            }
        }), 200

    except Exception:
        current_app.logger.exception(
            "Staff Dashboard query failed"
        )

        return jsonify({
            "success": False,
            "message": "Unable to retrieve dashboard data"
        }), 500

    finally:
        if connection:
            connection.close()
