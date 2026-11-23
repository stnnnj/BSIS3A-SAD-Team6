
"""
CCMC RetailFlow - Document Integration Testing

Based on:
CCMC_RetailFlow_Simple_Test_Cases(3).docx

Automated prerequisite checks:
IT-01 - Login, Session, and Logout
IT-08 - Invalid Stock Request Validation

NOTE:
Tests use mocked database connections.
No actual TiDB records are modified.

Full IT-02 through IT-14 workflows still require
isolated database and/or deployed-system testing.
"""

import app as app_module

from werkzeug.security import generate_password_hash


# -------------------------------------------------------
# FAKE DATABASE CONNECTION
# -------------------------------------------------------

class FakeConn:

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, *args):
        pass

    def fetchone(self):
        return {
            "user_id": 50,
            "name": "Integration Test",
            "username": "it_user",
            "password": generate_password_hash(
                "TestPass123"
            ),
            "role": "Staff",
            "is_active": 1
        }

    def close(self):
        pass


# -------------------------------------------------------
# IT-01 - LOGIN / SESSION / LOGOUT
# -------------------------------------------------------

def test_IT_01_login_session_logout(
    client,
    monkeypatch
):
    """
    Verify that authentication and session
    management work together using a fake DB.
    """

    monkeypatch.setattr(
        app_module,
        "get_db_connection",
        lambda: FakeConn()
    )

    # Step 1: Login
    response = client.post(
        "/api/auth/login",
        json={
            "username": "it_user",
            "password": "TestPass123"
        }
    )

    assert response.status_code == 200

    # Step 2: Verify active session
    response = client.get("/api/auth/me")

    assert response.status_code == 200

    assert (
        response.get_json()["user"]["role"]
        == "Staff"
    )

    # Step 3: Logout
    response = client.post("/api/auth/logout")

    assert response.status_code == 200

    # Step 4: Session must be invalid
    response = client.get("/api/auth/me")

    assert response.status_code == 401


# -------------------------------------------------------
# IT-08 - INVALID STOCK REQUEST VALIDATION
# -------------------------------------------------------

def test_IT_08_rejects_invalid_stock_request_before_sql(
    owner_session
):
    """
    Verify that invalid checkout quantities
    are rejected before database operations.

    Full insufficient-stock transaction testing
    must use an isolated database.
    """

    response = owner_session.post(
        "/api/retail/sales/checkout",
        json={
            "items": [
                {
                    "product_id": 1,
                    "quantity": -1
                }
            ]
        }
    )

    assert response.status_code == 400


# -------------------------------------------------------
# ADDITIONAL LOGIN SECURITY CHECK
# -------------------------------------------------------

def test_login_requires_credentials(client):
    """
    Login must reject requests without
    required username and password fields.
    """

    response = client.post(
        "/api/auth/login",
        json={}
    )

    assert response.status_code == 400


# -------------------------------------------------------
# ADDITIONAL SESSION SECURITY CHECK
# -------------------------------------------------------

def test_protected_route_requires_login(client):
    """
    Protected APIs must reject users
    who have not authenticated.
    """

    response = client.get("/api/users")

    assert response.status_code == 401
