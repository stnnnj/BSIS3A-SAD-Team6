
"""Flask client tests: no network, no real database, no genuine account needed."""

import pytest
from werkzeug.security import generate_password_hash

import app as app_module


class FakeCursor:
    def __init__(self, user):
        self.user = user
        self.parameters = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, parameters=None):
        assert "FROM users" in query
        self.parameters = parameters

    def fetchone(self):
        return self.user


class FakeConnection:
    def __init__(self, user):
        self.cursor_instance = FakeCursor(user)
        self.closed = False

    def cursor(self):
        return self.cursor_instance

    def close(self):
        self.closed = True


def fake_user(role="Owner", active=1):
    return dict(
        user_id=101,
        name="Demo Test User",
        username="demo_test",
        password=generate_password_hash("TestPassword123!"),
        role=role,
        is_active=active
    )


def test_health_and_home(client):
    health = client.get("/api/health")

    assert health.status_code == 200
    assert health.get_json()["status"] == "ok"

    home = client.get("/")

    assert home.get_json()["system"] == "CCMC RetailFlow"


def test_login_page_is_served(client):
    response = client.get("/frontend/index.html")

    assert response.status_code == 200
    assert b"CCMC RetailFlow" in response.data


@pytest.mark.parametrize(
    "body",
    [
        None,
        {},
        {"username": "", "password": "secret"},
        {"username": "test", "password": ""}
    ]
)
def test_login_missing_credentials_returns_400(
    client,
    body
):
    response = client.post(
        "/api/auth/login",
        json=body
    )

    assert response.status_code == 400
    assert response.get_json()["success"] is False


def test_owner_login_me_logout_and_revoked_session(
    client,
    monkeypatch
):
    fake = FakeConnection(fake_user())

    monkeypatch.setattr(
        app_module,
        "get_db_connection",
        lambda: fake
    )

    response = client.post(
        "/api/auth/login",
        json={
            "username": "demo_test",
            "password": "TestPassword123!"
        }
    )

    assert response.status_code == 200

    assert (
        response.get_json()["user"]["role"] == "Owner"
    )

    assert fake.cursor_instance.parameters == (
        "demo_test",
    )

    assert fake.closed is True

    response = client.get("/api/auth/me")

    assert (
        response.get_json()["user"]["username"]
        == "demo_test"
    )

    assert client.get("/api/test/owner").status_code == 200

    assert client.post("/api/auth/logout").status_code == 200

    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize(
    "role, active, password",
    [
        ("Owner", 1, "incorrect"),
        ("Owner", 0, "TestPassword123!"),
        ("Admin", 1, "TestPassword123!")
    ]
)
def test_login_rejects_invalid_or_inactive_account(
    client,
    monkeypatch,
    role,
    active,
    password
):
    monkeypatch.setattr(
        app_module,
        "get_db_connection",
        lambda: FakeConnection(fake_user(role, active))
    )

    response = client.post(
        "/api/auth/login",
        json={
            "username": "demo_test",
            "password": password
        }
    )

    assert response.status_code == 401

    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize(
    "route",
    [
        "/api/owner/dashboard",
        "/api/staff/dashboard",
        "/api/users",
        "/api/owner/products",
        "/api/owner/suppliers",
        "/api/financial/summary",
        "/api/owner/reports/summary",
        "/api/inventory/overview",
        "/api/inventory/transactions",
        "/api/retail/config",
        "/api/retail/products",
        "/api/retail/reservations",
        "/api/returns/history"
    ]
)
def test_anonymous_cannot_read_protected_apis(
    client,
    route
):
    response = client.get(route)

    assert response.status_code == 401


@pytest.mark.parametrize(
    "route",
    [
        "/api/owner/dashboard",
        "/api/users",
        "/api/owner/products",
        "/api/owner/suppliers",
        "/api/financial/summary",
        "/api/owner/reports/summary"
    ]
)
def test_staff_cannot_read_owner_apis(
    staff_session,
    route
):
    response = staff_session.get(route)

    assert response.status_code == 403


def test_staff_cannot_adjust_inventory(staff_session):
    response = staff_session.post(
        "/api/owner/inventory/adjustments",
        json={
            "product_id": 1,
            "quantity": 1,
            "direction": "in",
            "remarks": "test reason"
        }
    )

    assert response.status_code == 403


def test_owner_only_pages_redirect_without_owner(
    client,
    staff_session
):
    assert (
        staff_session.get(
            "/frontend/owner-dashboard.html"
        ).status_code == 302
    )

    assert (
        staff_session.get(
            "/frontend/users/users.html"
        ).status_code == 302
    )

    assert (
        staff_session.get(
            "/frontend/products/products.html"
        ).status_code == 302
    )


def test_staff_dashboard_can_be_served_to_staff(
    staff_session
):
    response = staff_session.get(
        "/frontend/staff-dashboard.html"
    )

    assert response.status_code == 200


def test_owner_dashboard_can_be_served_to_owner(
    owner_session
):
    response = owner_session.get(
        "/frontend/owner-dashboard.html"
    )

    assert response.status_code == 200


def test_both_roles_can_use_read_only_config_without_database(
    staff_session
):
    response = staff_session.get(
        "/api/retail/config"
    )

    assert response.status_code == 200

    assert (
        response.get_json()["discount_policy"]
        == "store_concession"
    )
