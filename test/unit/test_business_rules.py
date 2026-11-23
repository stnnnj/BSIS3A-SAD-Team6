
"""Unit tests for CCMC RetailFlow business rules.

These tests use application helper functions and do not intentionally
write records to the database.
"""

from datetime import date, datetime
from decimal import Decimal

import pytest

import sales
import reservations
import products
import financial
import reports
import inventory


# -------------------------------------------------------
# SALES / POS TESTING
# -------------------------------------------------------

def test_pos_money_rounds_half_up():
    assert sales.money("12.345") == Decimal("12.35")
    assert sales.money("0") == Decimal("0.00")


@pytest.mark.parametrize(
    "value",
    ["NaN", "Infinity", "not-money", None]
)
def test_pos_rejects_invalid_money(value):
    with pytest.raises(sales.BusinessError):
        sales.money(value)


def test_pos_groups_duplicate_items():
    items = [
        {"product_id": 2, "quantity": 3},
        {"product_id": "2", "quantity": "4"},
        {"product_id": 5, "quantity": 1},
    ]

    assert sales.parse_items(items) == {
        2: 7,
        5: 1
    }


@pytest.mark.parametrize(
    "items",
    [
        [],
        [{"product_id": True, "quantity": 1}],
        [{"product_id": 1, "quantity": 0}],
        [{"product_id": 1, "quantity": 1000}],
        [
            {"product_id": 1, "quantity": 800},
            {"product_id": 1, "quantity": 200},
        ],
        [{"product_id": -1, "quantity": 1}],
        "not-a-list",
    ]
)
def test_pos_rejects_invalid_items(items):
    with pytest.raises(sales.BusinessError):
        sales.parse_items(items)


# -------------------------------------------------------
# RESERVATION TESTING
# -------------------------------------------------------

def test_reservation_down_payment_exact_cents():
    assert reservations.reservation_down_payment(
        "150.50"
    ) == Decimal("150.50")

    assert reservations.reservation_down_payment(
        0
    ) == Decimal("0.00")


@pytest.mark.parametrize(
    "value",
    [None, True, "-1", "0.999", "abc", "1e2"]
)
def test_reservation_rejects_bad_down_payment(value):
    with pytest.raises(reservations.BusinessError):
        reservations.reservation_down_payment(value)


def test_reservation_expiration_bounds(monkeypatch):
    monkeypatch.setattr(
        reservations,
        "today_ph",
        lambda: date(2026, 11, 23)
    )

    assert reservations.parse_expiry(
        "2026-11-23"
    ) == date(2026, 11, 23)

    assert reservations.parse_expiry(
        "2027-11-23"
    ) == date(2027, 11, 23)

    for invalid_date in (
        "2026-11-22",
        "2027-11-24",
        "not-a-date"
    ):
        with pytest.raises(reservations.BusinessError):
            reservations.parse_expiry(invalid_date)


# -------------------------------------------------------
# PRODUCT TESTING
# -------------------------------------------------------

def test_product_decimal_validator():
    assert products.amount(
        {"selling_price": "19.99"},
        "selling_price"
    ) == Decimal("19.99")

    with pytest.raises(ValueError):
        products.amount(
            {"selling_price": "19.999"},
            "selling_price"
        )

    with pytest.raises(ValueError):
        products.amount(
            {"selling_price": -1},
            "selling_price"
        )


def test_product_integer_rejects_boolean_and_negative():
    assert products.integer(
        {"quantity": "8"},
        "quantity"
    ) == 8

    for invalid_value in (True, -1, "1.5"):
        with pytest.raises(ValueError):
            products.integer(
                {"quantity": invalid_value},
                "quantity"
            )


# -------------------------------------------------------
# FINANCIAL ANALYTICS TESTING
# -------------------------------------------------------

def test_financial_allocation_and_zero_gross():
    assert financial.net_unit_price(
        "100.00",
        "180.00",
        "200.00"
    ) == Decimal("90.00")

    assert financial.net_unit_price(
        "100.00",
        "0",
        "0"
    ) == Decimal("0.00")


# -------------------------------------------------------
# INVENTORY AND REPORTS TESTING
# -------------------------------------------------------

def test_inventory_and_report_serialization():
    original = {
        "amount": Decimal("12.50"),
        "day": date(2026, 11, 23)
    }

    expected = {
        "amount": "12.50",
        "day": "2026-11-23"
    }

    assert inventory.serialize_record(original) == expected

    assert reports.serialize_record(original) == expected

    report_data = {
        "timestamp": datetime(2026, 11, 23, 10, 30)
    }

    assert reports.serialize_record(report_data) == {
        "timestamp": "2026-11-23 10:30:00"
    }
