"""Owner product catalog, using the existing CCMC database and login session."""
from decimal import Decimal, InvalidOperation
from flask import Blueprint, current_app, jsonify, request, session, redirect
from db import get_db_connection

products_bp = Blueprint('owner_products', __name__)

@products_bp.before_app_request
def protect_products_page():
    if request.path == '/frontend/products/products.html':
        if 'user_id' not in session:
            return redirect('/frontend/index.html')
        if session.get('role') != 'Owner':
            return redirect('/frontend/staff-dashboard.html')

@products_bp.before_request
def authorize():
    if 'user_id' not in session:
        return fail('Please sign in.', 401)
    if session.get('role') != 'Owner':
        return fail('Owner access required.', 403)
    if request.method in ('POST', 'PUT', 'DELETE') and not request.is_json:
        return fail('JSON request required.', 415)
    if request.method in ('POST', 'PUT', 'DELETE') and request.headers.get('Origin') not in (None, request.host_url.rstrip('/')):
        return fail('Invalid request origin.', 403)

@products_bp.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'no-store'
    return response

def fail(message, status=400):
    return jsonify(success=False, message=message), status

def text_field(data, key, limit, required=False):
    value = data.get(key)
    if value is None: value = ''
    if not isinstance(value, str): raise ValueError(f'{key} must be text.')
    value = value.strip()
    if (required and not value) or len(value) > limit:
        raise ValueError(f'{key.replace("_", " ").capitalize()} must be {"1–" if required else "at most "}{limit} characters.')
    return value or None

def integer(data, key, minimum=0):
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not str(value).isdigit():
        raise ValueError(f'{key.replace("_", " ").capitalize()} must be a whole number.')
    result = int(value)
    if not minimum <= result <= 2147483647: raise ValueError(f'Invalid {key}.')
    return result

def amount(data, key):
    try:
        raw = data.get(key)
        if isinstance(raw, bool) or not isinstance(raw, (str, int, float)): raise ValueError
        value = Decimal(str(raw))
        if not value.is_finite() or value < 0 or value > Decimal('99999999.99') or value != value.quantize(Decimal('.01')): raise ValueError
        return value.quantize(Decimal('.01'))
    except (ValueError, InvalidOperation):
        raise ValueError(f'{key.replace("_", " ").capitalize()} must be a nonnegative amount with up to two decimals.')

def payload():
    data = request.get_json(silent=True)
    if not isinstance(data, dict): raise ValueError('Invalid JSON object.')
    return data

def product_values(data):
    return (integer(data,'category_id',1), integer(data,'supplier_id',1),
            text_field(data,'item_code',50,True), text_field(data,'barcode',100),
            text_field(data,'product_name',150,True), text_field(data,'brand',100),
            text_field(data,'size',30), text_field(data,'color',50),
            amount(data,'selling_price'), amount(data,'cost_price'), integer(data,'min_stock_level'))

def db_error(error):
    code = error.args[0] if error.args else None
    if code == 1062: return fail('Item code already exists.', 409)
    if code in (1451,1452): return fail('A related database record prevents this change.',409)
    current_app.logger.exception('Product database operation failed')
    return fail('Database operation failed. Check the server log and TiDB connection.', 503)

@products_bp.get('/api/owner/products')
def list_products():
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute('''SELECT p.product_id,p.category_id,p.supplier_id,p.item_code,p.barcode,
                p.product_name,p.brand,p.size,p.color,p.selling_price,p.cost_price,p.current_qty,
                p.min_stock_level,c.category_name,s.supplier_name
                FROM products p JOIN categories c ON c.category_id=p.category_id
                JOIN suppliers s ON s.supplier_id=p.supplier_id ORDER BY p.product_name,p.product_id''')
            products = cur.fetchall()
            cur.execute('SELECT category_id,category_name FROM categories ORDER BY category_name')
            categories = cur.fetchall()
            cur.execute('SELECT supplier_id,supplier_name FROM suppliers ORDER BY supplier_name')
            suppliers = cur.fetchall()
        return jsonify(success=True, products=products, categories=categories, suppliers=suppliers)
    except Exception as e: return db_error(e)
    finally:
        if conn is not None: conn.close()

@products_bp.post('/api/owner/products/categories')
def create_category():
    conn = None
    try:
        name = text_field(payload(),'category_name',100,True)
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute('SELECT category_id FROM categories WHERE category_name=%s LIMIT 1',(name,))
            if cur.fetchone(): return fail('Category already exists.',409)
            cur.execute('INSERT INTO categories (category_name) VALUES (%s)',(name,))
            category_id=cur.lastrowid
        conn.commit()
        return jsonify(success=True,category_id=category_id,message='Category added.'),201
    except ValueError as e: return fail(str(e))
    except Exception as e:
        if conn is not None: conn.rollback()
        return db_error(e)
    finally:
        if conn is not None: conn.close()

@products_bp.post('/api/owner/products')
@products_bp.put('/api/owner/products/<int:product_id>')
def save_product(product_id=None):
    conn = None
    try:
        values = product_values(payload())
        conn = get_db_connection()
        with conn.cursor() as cur:
            if product_id is not None:
                cur.execute('SELECT product_id FROM products WHERE product_id=%s FOR UPDATE',(product_id,))
                if not cur.fetchone(): return fail('Product not found.',404)
            cur.execute('SELECT category_id FROM categories WHERE category_id=%s',(values[0],))
            if not cur.fetchone(): return fail('Select an existing category.')
            cur.execute('SELECT supplier_id FROM suppliers WHERE supplier_id=%s',(values[1],))
            if not cur.fetchone(): return fail('Select an existing supplier.')
            if product_id is None:
                cur.execute('''INSERT INTO products (category_id,supplier_id,item_code,barcode,product_name,brand,size,color,selling_price,cost_price,min_stock_level,current_qty)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0)''', values)
                product_id=cur.lastrowid
                created=True
            else:
                cur.execute('''UPDATE products SET category_id=%s,supplier_id=%s,item_code=%s,barcode=%s,product_name=%s,brand=%s,size=%s,color=%s,selling_price=%s,cost_price=%s,min_stock_level=%s WHERE product_id=%s''',values+(product_id,))
                created=False
        conn.commit()
        return jsonify(success=True,product_id=product_id,message='Product added. Use Inventory to record stock.' if created else 'Product updated.'),201 if created else 200
    except ValueError as e: return fail(str(e))
    except Exception as e:
        if conn is not None: conn.rollback()
        return db_error(e)
    finally:
        if conn is not None: conn.close()

@products_bp.delete('/api/owner/products/<int:product_id>')
def delete_product(product_id):
    conn=None
    try:
        conn=get_db_connection()
        with conn.cursor() as cur:
            cur.execute('SELECT current_qty FROM products WHERE product_id=%s FOR UPDATE',(product_id,))
            product=cur.fetchone()
            if not product: return fail('Product not found.',404)
            if product['current_qty'] != 0: return fail('Only products with zero stock can be deleted.',409)
            for table in ('sale_items','order_items','inventory_transactions'):
                cur.execute(f'SELECT 1 FROM {table} WHERE product_id=%s LIMIT 1',(product_id,))
                if cur.fetchone(): return fail('Product has transaction history and cannot be deleted.',409)
            cur.execute('DELETE FROM products WHERE product_id=%s',(product_id,))
        conn.commit()
        return jsonify(success=True,message='Unused product deleted.')
    except Exception as e:
        if conn is not None: conn.rollback()
        return db_error(e)
    finally:
        if conn is not None: conn.close()
