
from datetime import datetime
from uuid import UUID

from flask import Blueprint, current_app, jsonify, request, session
from db import get_db_connection
from financial import amount, net_unit_price, to_number

returns_bp = Blueprint("returns", __name__, url_prefix="/api/returns")


@returns_bp.before_request
def require_staff_or_owner():
    if "user_id" not in session:
        return jsonify(success=False, message="Authentication required."), 401
    if session.get("role") not in ("Owner", "Staff"):
        return jsonify(success=False, message="Staff or Owner access required."), 403


def receipt_data(cursor, receipt_no):
    cursor.execute("""
        SELECT sale_id, receipt_no, customer_name, sale_date,
               payment_method, total_amount, status
        FROM sales WHERE receipt_no = %s LIMIT 1
    """, (receipt_no,))
    sale = cursor.fetchone()
    if not sale or sale["status"] != "Completed":
        return None

    cursor.execute("""
        SELECT si.sale_item_id, si.product_id, si.quantity,
               si.unit_price, si.unit_cost, p.product_name,
               p.item_code, p.current_qty,
               (SELECT COALESCE(SUM(r.quantity), 0)
                FROM returns r WHERE r.sale_item_id = si.sale_item_id)
                AS returned_qty
        FROM sale_items si
        JOIN products p ON p.product_id = si.product_id
        WHERE si.sale_id = %s
        ORDER BY si.sale_item_id
    """, (sale["sale_id"],))
    source_items = cursor.fetchall()
    gross_total = sum(
        (amount(x["unit_price"]) * int(x["quantity"]) for x in source_items),
        amount(0)
    )
    items = []
    for item in source_items:
        net = net_unit_price(item["unit_price"], sale["total_amount"], gross_total)
        items.append({
            "sale_item_id": item["sale_item_id"],
            "code": item["item_code"],
            "name": item["product_name"],
            "sold": int(item["quantity"]),
            "returned": int(item["returned_qty"]),
            "price": to_number(item["unit_price"]),
            "net": to_number(net),
            "cost": to_number(item["unit_cost"]),
            "onHand": int(item["current_qty"]),
        })
    return {
        "receipt_no": sale["receipt_no"],
        "customer": sale["customer_name"] or "",
        "date": sale["sale_date"].isoformat()
                if hasattr(sale["sale_date"], "isoformat") else str(sale["sale_date"]),
        "paid": to_number(sale["total_amount"]),
        "method": sale["payment_method"],
        "items": items,
    }


@returns_bp.get("/history")
def list_return_history():
    """Read recorded return entries from the existing database schema."""
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT
                    r.return_id,
                    r.original_receipt_no,
                    r.return_date,
                    r.quantity,
                    r.refund_amount,
                    r.reason,
                    r.customer_name,
                    si.sale_item_id,
                    p.item_code,
                    p.product_name,
                    EXISTS (
                        SELECT 1
                        FROM inventory_transactions it
                        WHERE it.return_id = r.return_id
                          AND it.quantity > 0
                          AND LOWER(it.txn_type) = 'return'
                    ) AS restocked
                FROM returns r
                JOIN sale_items si ON si.sale_item_id = r.sale_item_id
                JOIN products p ON p.product_id = si.product_id
                ORDER BY r.return_date DESC, r.return_id DESC
                LIMIT 200
            """)
            records = cursor.fetchall()

        def audit_value(reason, key):
            # Metadata is appended to the existing reason TEXT field.
            # Condition notes can span multiple lines.
            value = reason or ""
            prefix = f"[{key}: "
            start = value.find("\n" + prefix)
            if start >= 0:
                start += 1
            elif value.startswith(prefix):
                start = 0
            else:
                return None
            contents = value[start + len(prefix):]
            end = contents.find("]")
            return contents[:end] if end >= 0 else None

        def clean_reason(reason):
            text = reason or ""
            # Return the user-selected reason without our structured audit lines.
            for key in ("Refund method", "Processed by user ID", "Restocked", "Condition notes", "Request ID"):
                pos = text.find("\n[" + key + ": ")
                if pos >= 0:
                    text = text[:pos]
            return text.strip()

        history = []
        for row in records:
            history.append({
                "return_id": int(row["return_id"]),
                "reference": f"R-{row['return_id']}",
                "receipt_no": row["original_receipt_no"],
                "date": (
                    row["return_date"].isoformat()
                    if hasattr(row["return_date"], "isoformat")
                    else str(row["return_date"])
                ),
                "customer": row["customer_name"] or "",
                "product": f"{row['item_code']} · {row['product_name']}",
                "quantity": int(row["quantity"]),
                "refund_amount": to_number(row["refund_amount"]),
                "refund_method": audit_value(row["reason"], "Refund method") or "",
                "reason": clean_reason(row["reason"]),
                "condition_notes": audit_value(row["reason"], "Condition notes") or "",
                "processed_by": audit_value(row["reason"], "Processed by user ID") or "",
                "restocked": bool(row["restocked"]),
            })

        return jsonify(success=True, history=history, limit=200)
    except Exception:
        current_app.logger.exception("Returns history query failed")
        return jsonify(success=False, message="Unable to load return history."), 500
    finally:
        if conn is not None:
            conn.close()


@returns_bp.get("/receipt")
def find_receipt():
    receipt_no = (request.args.get("receipt_no") or "").strip()
    if not receipt_no or len(receipt_no) > 50:
        return jsonify(success=False, message="Enter a valid receipt number."), 400

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            sale = receipt_data(cursor, receipt_no)
        if sale is None:
            return jsonify(success=False, message="No completed sale found for this receipt."), 404
        return jsonify(success=True, sale=sale)
    except Exception:
        current_app.logger.exception("Receipt lookup failed")
        return jsonify(success=False, message="Unable to look up the receipt."), 500
    finally:
        if conn is not None:
            conn.close()


@returns_bp.post("")
def create_return():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(success=False, message="A JSON request body is required."), 400

    receipt_no = data.get("receipt_no")
    sale_item_id = data.get("sale_item_id")
    qty = data.get("quantity")
    reason = data.get("reason")
    notes = data.get("condition_notes", "")
    refund_method = data.get("refund_method")
    restock = data.get("restock")
    verified = data.get("verified")
    request_id = data.get("request_id")

    if not isinstance(receipt_no, str) or not receipt_no.strip() or len(receipt_no) > 50:
        return jsonify(success=False, message="A valid receipt number is required."), 400
    if type(sale_item_id) is not int or sale_item_id <= 0:
        return jsonify(success=False, message="Select a valid sale item."), 400
    if type(qty) is not int or qty <= 0:
        return jsonify(success=False, message="Return quantity must be a positive whole number."), 400
    if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 500:
        return jsonify(success=False, message="A reason is required (maximum 500 characters)."), 400
    if not isinstance(notes, str) or len(notes) > 2000:
        return jsonify(success=False, message="Condition notes must be 2000 characters or fewer."), 400
    if refund_method not in ("Cash", "GCash"):
        return jsonify(success=False, message="Choose Cash or GCash as the refund method."), 400
    if type(restock) is not bool or verified is not True:
        return jsonify(success=False, message="Verify the refund and choose whether to restock."), 400
    try:
        if not isinstance(request_id, str) or str(UUID(request_id)) != request_id.lower():
            raise ValueError("Invalid request ID")
    except (TypeError, ValueError, AttributeError):
        return jsonify(success=False, message="A valid unique request ID is required."), 400

    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            # Lock the sale item first, serializing returns on the same item.
            cursor.execute("""
                SELECT si.sale_item_id, si.sale_id, si.product_id,
                       si.quantity, si.unit_price, si.unit_cost,
                       s.receipt_no, s.total_amount, s.status, s.customer_name,
                       p.item_code, p.product_name, p.current_qty
                FROM sale_items si
                JOIN sales s ON s.sale_id = si.sale_id
                JOIN products p ON p.product_id = si.product_id
                WHERE si.sale_item_id = %s AND s.receipt_no = %s
                FOR UPDATE
            """, (sale_item_id, receipt_no.strip()))
            item = cursor.fetchone()
            if not item or item["status"] != "Completed":
                return jsonify(success=False, message="The completed receipt/item was not found."), 404

            # Re-read locked return rows so simultaneous requests cannot
            # refund more units than were originally sold.
            cursor.execute("""
                SELECT quantity, reason FROM returns
                WHERE sale_item_id = %s FOR UPDATE
            """, (sale_item_id,))
            previous_returns = cursor.fetchall()
            request_marker = f"[Request ID: {request_id.lower()}]"
            if any(request_marker in (r["reason"] or "") for r in previous_returns):
                return jsonify(success=False, message="This refund request was already recorded. Search the receipt again."), 409
            already_returned = sum(int(r["quantity"]) for r in previous_returns)
            if qty > int(item["quantity"]) - already_returned:
                return jsonify(success=False, message="Return quantity exceeds the remaining quantity sold."), 409

            cursor.execute("""
                SELECT COALESCE(SUM(quantity * unit_price), 0) AS gross
                FROM sale_items WHERE sale_id = %s
            """, (item["sale_id"],))
            gross = cursor.fetchone()["gross"]
            net_price = net_unit_price(item["unit_price"], item["total_amount"], gross)
            refund_amount = amount(net_price * qty)
            if refund_amount <= 0:
                return jsonify(success=False, message="This item has no refundable paid amount."), 409

            # The original returns table has no refund_method, processed_by,
            # condition_notes, restocked or request_id columns.
            # Store audit details in its existing TEXT reason field.
            audit = [
                reason.strip(),
                f"[Refund method: {refund_method}]",
                f"[Processed by user ID: {session['user_id']}]",
                f"[Restocked: {'Yes' if restock else 'No'}]",
            ]
            if notes.strip():
                audit.append(f"[Condition notes: {notes.strip()}]")
            audit.append(request_marker)
            recorded_reason = "\n".join(audit)

            cursor.execute("""
                INSERT INTO returns (
                    sale_item_id, original_receipt_no, return_date,
                    reason, quantity, refund_amount, customer_name
                ) VALUES (%s, %s, CURDATE(), %s, %s, %s, %s)
            """, (
                sale_item_id, item["receipt_no"], recorded_reason,
                qty, refund_amount, item["customer_name"],
            ))
            return_id = cursor.lastrowid
            old_stock = int(item["current_qty"])
            txn_id = None

            if restock:
                cursor.execute("""
                    UPDATE products SET current_qty = current_qty + %s
                    WHERE product_id = %s
                """, (qty, item["product_id"]))
                cursor.execute("""
                    INSERT INTO inventory_transactions (
                        product_id, user_id, txn_type, quantity,
                        txn_date, remarks, sale_item_id, return_id
                    ) VALUES (%s, %s, 'Return', %s, NOW(), %s, %s, %s)
                """, (
                    item["product_id"], session["user_id"], qty,
                    f"Restock from return R-{return_id} / receipt {item['receipt_no']}",
                    sale_item_id, return_id,
                ))
                txn_id = cursor.lastrowid

        conn.commit()
        return jsonify(success=True, result={
            "return_id": return_id,
            "reference": f"R-{return_id}",
            "refund_reference": f"RF-{return_id}",
            "receipt_no": item["receipt_no"],
            "product_code": item["item_code"],
            "product_name": item["product_name"],
            "customer": item["customer_name"] or "",
            "quantity": qty,
            "net_unit": to_number(net_price),
            "refund_amount": to_number(refund_amount),
            "refund_method": refund_method,
            "reason": reason.strip(),
            "restocked": restock,
            "previous_stock": old_stock,
            "new_stock": old_stock + qty if restock else old_stock,
            "inventory_txn_id": txn_id,
            "processed_by": session.get("name") or session.get("username") or "",
            "recorded_at": datetime.now().isoformat(timespec="seconds"),
        }), 201
    except Exception:
        if conn is not None:
            conn.rollback()
        current_app.logger.exception("Return transaction failed")
        return jsonify(success=False, message="Unable to record refund. No database changes were committed."), 500
    finally:
        if conn is not None:
            conn.close()
