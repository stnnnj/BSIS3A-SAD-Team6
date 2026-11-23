
"""Shared fixtures for the actual CCMC RetailFlow Flask application.

Safety: Default pytest tests NEVER contact TiDB. Every module's DB connector
is blocked unless a specific test replaces it with a fake connection.
"""
import importlib
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"

if not (BACKEND / "app.py").exists():
    raise RuntimeError(
        "Put the 'tests' folder beside 'backend' and 'frontend' in BSIS3A-SAD-Team6."
    )

sys.path.insert(0, str(BACKEND))

# Define a test-only secret BEFORE app.py loads .env.
# No actual credential is needed.
os.environ["FLASK_SECRET_KEY"] = (
    "ccmc-test-only-not-for-deployment-2026-0123456789"
)

app_module = importlib.import_module("app")


def _live_db_forbidden():
    raise AssertionError(
        "A default test tried to open the REAL database! "
        "Use a mocked connection, or the explicitly gated isolated-DB suite."
    )


@pytest.fixture(autouse=True)
def block_real_database(monkeypatch):
    # Even opt-in integration tests use their own
    # explicit test-only connection.
    for module_name in (
        "app",
        "db",
        "sales",
        "reservations",
        "inventory",
        "reports",
        "financial",
        "returns",
        "users",
        "products",
        "suppliers",
        "owner_dashboard",
        "staff_dashboard",
    ):
        module = sys.modules.get(module_name)

        if module is not None and hasattr(module, "get_db_connection"):
            monkeypatch.setattr(
                module,
                "get_db_connection",
                _live_db_forbidden
            )


@pytest.fixture
def app():
    application = app_module.app

    application.config.update(
        TESTING=True,
        SECRET_KEY="unit-test-secret-no-real-data"
    )

    return application


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def owner_session(client):
    with client.session_transaction() as sess:
        sess.update(
            user_id=1001,
            name="Test Owner",
            username="test_owner",
            role="Owner"
        )

    return client


@pytest.fixture
def staff_session(client):
    with client.session_transaction() as sess:
        sess.update(
            user_id=1002,
            name="Test Staff",
            username="test_staff",
            role="Staff"
        )

    return client
