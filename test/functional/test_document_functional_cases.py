
"""Safe automated portions of FT cases; state-changing FT cases are in MANUAL_EXECUTION.md.
No real database is contacted. Do not report an entire FT case PASS when only a subset ran.
"""
from werkzeug.security import generate_password_hash
import app as app_module


class Conn:
    def __init__(self, role):
        self.role = role

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, *a):
        pass

    def fetchone(self):
        return dict(
            user_id=1001,
            name="Demo",
            username="test_account",
            password=generate_password_hash("TestPass123"),
            role=self.role,
            is_active=1
        )

    def close(self):
        pass


def login(client, monkeypatch, role):
    monkeypatch.setattr(
        app_module,
        "get_db_connection",
        lambda: Conn(role)
    )

    return client.post(
        "/api/auth/login",
        json={
            "username": "test_account",
            "password": "TestPass123"
        }
    )


def test_FT_01_owner_sign_in_out(client, monkeypatch):
    assert login(client, monkeypatch, "Owner").status_code == 200

    assert (
        client.get("/api/auth/me")
        .get_json()["user"]["role"] == "Owner"
    )

    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_FT_02_staff_sign_in_out(client, monkeypatch):
    assert login(client, monkeypatch, "Staff").status_code == 200

    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_FT_03_invalid_login(client, monkeypatch):
    monkeypatch.setattr(
        app_module,
        "get_db_connection",
        lambda: Conn("Staff")
    )

    response = client.post(
        "/api/auth/login",
        json={
            "username": "test_account",
            "password": "wrong"
        }
    )

    assert response.status_code == 401


def test_FT_04_owner_dashboard_navigation(owner_session):
    response = owner_session.get(
        "/frontend/owner-dashboard.html"
    )

    assert response.status_code == 200


def test_FT_05_staff_dashboard_navigation(staff_session):
    response = staff_session.get(
        "/frontend/staff-dashboard.html"
    )

    assert response.status_code == 200


def test_FT_08_deletion_rejects_staff(staff_session):
    # Permission check only. Deletion rules need isolated DB tests.
    response = staff_session.delete(
        "/api/owner/products/1"
    )

    assert response.status_code == 403


def test_FT_11_owner_self_lockout_requires_live_workflow(
    owner_session
):
    # Owner access check only.
    # Self-lockout prevention requires separate testing.
    response = owner_session.get("/api/test/owner")

    assert response.status_code == 200


def test_FT_12_inventory_read_only(
    staff_session,
    monkeypatch
):
    import inventory

    monkeypatch.setattr(
        inventory,
        "rows_query",
        lambda *_a, **_k: [
            {
                "product_id": 1,
                "current_qty": 2,
                "stock_status": "Low Stock"
            }
        ]
    )

    response = staff_session.get(
        "/api/inventory/overview"
    )

    assert response.status_code == 200

    assert (
        response.get_json()["stats"]["low_stock"] == 1
    )


def test_FT_19_reports_invalid_filter(owner_session):
    response = owner_session.get(
        "/api/owner/reports/summary"
        "?from=2026-11-25&to=2026-11-23"
    )

    assert response.status_code == 400


def test_FT_20_financial_invalid_filter(owner_session):
    response = owner_session.get(
        "/api/financial/summary"
        "?start_date=2026-11-25&end_date=2026-11-23"
    )

    assert response.status_code == 400


def test_FT_21_staff_cannot_access_owner_features(
    staff_session
):
    routes = (
        "/api/users",
        "/api/owner/products",
        "/api/owner/suppliers",
        "/api/financial/summary"
    )

    for route in routes:
        response = staff_session.get(route)

        assert response.status_code == 403, route
