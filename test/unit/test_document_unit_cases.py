
"""UT-01..UT-12: exact IDs in CCMC_RetailFlow_Simple_Test_Cases(3).docx.
Offline tests call actual helpers in the user's backend. No TiDB access.
"""
from datetime import date
from decimal import Decimal
import pytest
import products, users, sales, reservations, financial, reports


def valid_user():
    return {"name":"Test User", "username":"test_user", "role":"Staff", "is_active":1, "password":"StrongPass123"}


def product():
    return {"category_id":1,"supplier_id":1,"item_code":"TEST001", "product_name":"Test Shirt", "selling_price":"150.00", "cost_price":"80.00", "min_stock_level":2}


def test_UT_01_required_product_fields():
    d=product(); assert products.product_values(d)
    for key in ("item_code","product_name"):
        bad=dict(d);bad[key]=""
        with pytest.raises(ValueError): products.product_values(bad)


def test_UT_02_quantity_and_amount_validation():
    assert products.integer({"quantity":"12"},"quantity")==12
    assert products.amount({"selling_price":"150.00"},"selling_price")==Decimal("150.00")
    for value in (-1,"1.2",True):
        with pytest.raises(ValueError): products.integer({"quantity":value},"quantity")
    for value in (-1,"abc","10.123"):
        with pytest.raises(ValueError): products.amount({"selling_price":value},"selling_price")


def test_UT_03_category_and_supplier_ids():
    for key in ("category_id","supplier_id"):
        d=product(); d[key]=0
        with pytest.raises(ValueError): products.product_values(d)
    # Existence in TiDB is verified separately in IT-04, not inferred here.


def test_UT_04_username_format_validation():
    assert users.validate_user(valid_user(),True) is None
    for value in ("bad user","bad@user","bad/user"):
        d=valid_user();d["username"]=value
        assert users.validate_user(d,True)


def test_UT_05_password_length_validation():
    for password in ("short","", "x"*129):
        d=valid_user();d["password"]=password
        assert users.validate_user(d,True)
    assert users.validate_user(valid_user(),True) is None


def test_UT_06_role_and_account_status():
    for key,value in (("role","Administrator"),("is_active",2),("is_active",True)):
        d=valid_user();d[key]=value
        assert users.validate_user(d,True)
    assert users.validate_user(valid_user(),True) is None


def test_UT_07_item_quantity_validation():
    assert sales.parse_items([{"product_id":1,"quantity":2}])=={1:2}
    for q in (0,-1,1000,"1.5"):
        with pytest.raises(sales.BusinessError): sales.parse_items([{"product_id":1,"quantity":q}])


def test_UT_08_duplicate_item_quantity_calculation():
    assert sales.parse_items([{"product_id":1,"quantity":2},{"product_id":"1","quantity":3}])=={1:5}


def test_UT_09_reservation_expiration(monkeypatch):
    monkeypatch.setattr(reservations,"today_ph",lambda:date(2026,11,23))
    assert reservations.parse_expiry("2026-11-24")==date(2026,11,24)
    with pytest.raises(reservations.BusinessError):reservations.parse_expiry("2026-11-22")


def test_UT_10_down_payment():
    assert reservations.reservation_down_payment("25.50")==Decimal("25.50")
    for bad in (-1,"abc","10.001"):
        with pytest.raises(reservations.BusinessError):reservations.reservation_down_payment(bad)


def test_UT_11_amount_and_refund_calculations():
    assert financial.net_unit_price("100.00","180.00","200.00")==Decimal("90.00")
    assert financial.net_unit_price("100.00",0,0)==Decimal("0.00")
    # Verify full transaction-based refund independently in IT-12.


def test_UT_12_origin_role_and_date_validation(client,staff_session):
    assert staff_session.get("/api/users").status_code==403
    assert financial.parse_date("2026-11-23","start_date")==date(2026,11,23)
    with pytest.raises(ValueError):financial.parse_date("bad-date","start_date")
    # Untrusted cross-origin requests require a separate browser/CORS check.
