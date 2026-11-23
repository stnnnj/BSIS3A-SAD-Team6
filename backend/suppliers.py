
"""Owner supplier directory; shares products' supplier_id foreign key."""

from flask import Blueprint, current_app, jsonify, request, session, redirect
from db import get_db_connection

suppliers_bp = Blueprint('owner_suppliers', __name__)


@suppliers_bp.before_app_request
def protect_suppliers_page():
    if request.path == '/frontend/suppliers/suppliers.html':
        if 'user_id' not in session:
            return redirect('/frontend/index.html')
        if session.get('role') != 'Owner':
            return redirect('/frontend/staff-dashboard.html')


@suppliers_bp.before_request
def authorize():
    if 'user_id' not in session:
        return fail('Please sign in.', 401)

    if session.get('role') != 'Owner':
        return fail('Owner access required.', 403)

    if request.method in ('POST', 'PUT', 'DELETE') and not request.is_json:
        return fail('JSON request required.', 415)

    # Allow requests from the trusted Netlify frontend.
    if request.method in ('POST', 'PUT', 'DELETE') and request.headers.get('Origin') not in (
        None,
        request.host_url.rstrip('/'),
        'https://ccmc-retailflow.netlify.app'
    ):
        return fail('Invalid request origin.', 403)


@suppliers_bp.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


def fail(message, status=400):
    return jsonify(success=False, message=message), status


def db_error(error):
    if error.args and error.args[0] in (1451, 1452):
        return fail('Supplier is linked to another record.', 409)

    current_app.logger.exception('Supplier database operation failed')
    return fail('Database operation failed. Check the server log and TiDB connection.', 503)


@suppliers_bp.get('/api/owner/suppliers')
def list_suppliers():
    conn = None
    try:
        conn = get_db_connection()

        with conn.cursor() as cur:
            cur.execute('''SELECT s.supplier_id,s.supplier_name,s.contact_no,COUNT(p.product_id) AS product_count
                FROM suppliers s LEFT JOIN products p ON p.supplier_id=s.supplier_id
                GROUP BY s.supplier_id,s.supplier_name,s.contact_no ORDER BY s.supplier_name,s.supplier_id''')

            suppliers = cur.fetchall()

        return jsonify(success=True, suppliers=suppliers)

    except Exception as e:
        return db_error(e)

    finally:
        if conn is not None:
            conn.close()


@suppliers_bp.get('/api/owner/suppliers/<int:supplier_id>/products')
def linked_products(supplier_id):
    conn = None
    try:
        conn = get_db_connection()

        with conn.cursor() as cur:
            cur.execute(
                'SELECT supplier_id FROM suppliers WHERE supplier_id=%s',
                (supplier_id,)
            )

            if not cur.fetchone():
                return fail('Supplier not found.', 404)

            cur.execute(
                'SELECT product_id,item_code,product_name,current_qty FROM products WHERE supplier_id=%s ORDER BY product_name',
                (supplier_id,)
            )

            products = cur.fetchall()

        return jsonify(success=True, products=products)

    except Exception as e:
        return db_error(e)

    finally:
        if conn is not None:
            conn.close()


@suppliers_bp.post('/api/owner/suppliers')
@suppliers_bp.put('/api/owner/suppliers/<int:supplier_id>')
def save_supplier(supplier_id=None):
    conn = None
    try:
        data = request.get_json(silent=True)

        if not isinstance(data, dict):
            return fail('Invalid JSON object.')

        name = data.get('supplier_name')
        contact = data.get('contact_no')

        if contact is None:
            contact = ''

        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
            return fail('Supplier name must be 1–100 characters.')

        if not isinstance(contact, str) or len(contact.strip()) > 20:
            return fail('Contact number must be at most 20 characters.')

        name = name.strip()
        contact = contact.strip() or None

        conn = get_db_connection()

        with conn.cursor() as cur:
            created = supplier_id is None

            if created:
                cur.execute(
                    'INSERT INTO suppliers (supplier_name,contact_no) VALUES (%s,%s)',
                    (name, contact)
                )

                supplier_id = cur.lastrowid

            else:
                cur.execute(
                    'SELECT supplier_id FROM suppliers WHERE supplier_id=%s FOR UPDATE',
                    (supplier_id,)
                )

                if not cur.fetchone():
                    return fail('Supplier not found.', 404)

                cur.execute(
                    'UPDATE suppliers SET supplier_name=%s,contact_no=%s WHERE supplier_id=%s',
                    (name, contact, supplier_id)
                )

        conn.commit()

        return jsonify(
            success=True,
            supplier_id=supplier_id,
            message='Supplier added.' if created else 'Supplier updated.'
        ), 201 if created else 200

    except Exception as e:
        if conn is not None:
            conn.rollback()

        return db_error(e)

    finally:
        if conn is not None:
            conn.close()


@suppliers_bp.delete('/api/owner/suppliers/<int:supplier_id>')
def delete_supplier(supplier_id):
    conn = None
    try:
        conn = get_db_connection()

        with conn.cursor() as cur:
            cur.execute(
                'SELECT supplier_id FROM suppliers WHERE supplier_id=%s FOR UPDATE',
                (supplier_id,)
            )

            if not cur.fetchone():
                return fail('Supplier not found.', 404)

            cur.execute(
                'SELECT 1 FROM products WHERE supplier_id=%s LIMIT 1',
                (supplier_id,)
            )

            if cur.fetchone():
                return fail(
                    'Reassign linked products before deleting this supplier.',
                    409
                )

            cur.execute(
                'DELETE FROM suppliers WHERE supplier_id=%s',
                (supplier_id,)
            )

        conn.commit()

        return jsonify(
            success=True,
            message='Supplier deleted.'
        )

    except Exception as e:
        if conn is not None:
            conn.rollback()

        return db_error(e)

    finally:
        if conn is not None:
            conn.close()
