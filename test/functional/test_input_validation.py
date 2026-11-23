
"""Test invalid user inputs before any potentially modifying SQL runs."""

import pytest


@pytest.mark.parametrize(
    "path,payload",
    [
        (
            "/api/retail/sales/checkout",
            {"items": []}
        ),
        (
            "/api/retail/sales/checkout",
            {
                "items": [
                    {"product_id": 1, "quantity": -1}
                ]
            }
        ),
        (
            "/api/retail/reservations",
            {"customer_name": ""}
        ),
        (
            "/api/retail/reservations",
            {
                "customer_name": "A",
                "expiry_date": "invalid"
            }
        ),
        (
            "/api/owner/products",
            {"category_id": 1}
        ),
        (
            "/api/owner/suppliers",
            {"supplier_name": ""}
        ),
        (
            "/api/owner/inventory/adjustments",
            {
                "product_id": 1,
                "quantity": 0,
                "direction": "in",
                "remarks": "Test adjustment"
            }
        ),
        (
            "/api/returns",
            {}
        )
    ]
)
def test_invalid_mutating_requests_cannot_reach_database(
    owner_session,
    path,
    payload
):
    response = owner_session.post(
        path,
        json=payload
    )

    assert response.status_code == 400, (
        path,
        response.get_json()
    )


def test_missing_receipt_is_rejected_without_database(
    owner_session
):
    response = owner_session.get(
        "/api/returns/receipt"
    )

    assert response.status_code == 400


@pytest.mark.parametrize(
    "bad_limit",
    ["0", "201", "abc"]
)
def test_inventory_rejects_bad_transaction_limit(
    staff_session,
    bad_limit
):
    response = staff_session.get(
        "/api/inventory/transactions?limit=" + bad_limit
    )

    assert response.status_code == 400


def test_owner_reports_rejects_invalid_date_range(
    owner_session
):
    response = owner_session.get(
        "/api/owner/reports/summary"
        "?from=2026-11-25&to=2026-11-23"
    )

    assert response.status_code == 400


def test_owner_reports_rejects_unknown_report_type(
    owner_session
):
    response = owner_session.get(
        "/api/owner/reports/data?type=unknown"
    )

    assert response.status_code == 400


def test_financial_rejects_inverted_dates(
    owner_session
):
    response = owner_session.get(
        "/api/financial/summary"
        "?start_date=2026-11-25&end_date=2026-11-23"
    )

    assert response.status_code == 400


def test_read_only_staff_inventory_with_mocked_rows(
    staff_session,
    monkeypatch
):
    import inventory

    monkeypatch.setattr(
        inventory,
        "rows_query",
        lambda *_args, **_kwargs: [
            {
                "product_id": 1,
                "current_qty": 4,
                "stock_status": "Low Stock"
            },
            {
                "product_id": 2,
                "current_qty": 6,
                "stock_status": "In Stock"
            }
        ]
    )

    response = staff_session.get(
        "/api/inventory/overview"
    )

    assert response.status_code == 200

    result = response.get_json()

    assert result["stats"] == {
        "products": 2,
        "units": 10,
        "low_stock": 1,
        "out_of_stock": 0
    }
