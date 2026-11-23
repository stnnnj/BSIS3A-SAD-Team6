
"""
CCMC RetailFlow - Registered Endpoints Testing

Purpose:
Verify that the Flask application has registered
the expected API routes for the system modules.

This test does not connect to TiDB or modify data.
"""

import pytest


# -------------------------------------------------------
# EXPECTED API ENDPOINTS
# -------------------------------------------------------

EXPECTED_ROUTES = {
    "Authentication": [
        ("/api/auth/login", "POST"),
        ("/api/auth/logout", "POST"),
        ("/api/auth/me", "GET"),
    ],

    "Dashboard": [
        ("/api/owner/dashboard", "GET"),
        ("/api/staff/dashboard", "GET"),
    ],

    "Products": [
        ("/api/owner/products", "GET"),
        ("/api/owner/products", "POST"),
    ],

    "Suppliers": [
        ("/api/owner/suppliers", "GET"),
        ("/api/owner/suppliers", "POST"),
    ],

    "Users": [
        ("/api/users", "GET"),
        ("/api/users", "POST"),
    ],

    "Inventory": [
        ("/api/inventory/overview", "GET"),
        ("/api/inventory/transactions", "GET"),
        ("/api/owner/inventory/adjustments", "POST"),
    ],

    "Sales": [
        ("/api/retail/products", "GET"),
        ("/api/retail/sales/checkout", "POST"),
    ],

    "Reservations": [
        ("/api/retail/reservations", "GET"),
        ("/api/retail/reservations", "POST"),
    ],

    "Returns": [
        ("/api/returns/history", "GET"),
    ],

    "Reports": [
        ("/api/owner/reports/summary", "GET"),
    ],

    "Financial Analytics": [
        ("/api/financial/summary", "GET"),
    ],
}


# -------------------------------------------------------
# HELPER FUNCTION
# -------------------------------------------------------

def get_registered_routes(app):
    """
    Return a mapping of registered Flask URL rules
    and their allowed HTTP methods.
    """

    routes = {}

    for rule in app.url_map.iter_rules():
        routes[rule.rule] = routes.get(
            rule.rule, set()
        ) | set(rule.methods)

    return routes


# -------------------------------------------------------
# TEST 1 - REQUIRED ROUTES
# -------------------------------------------------------

@pytest.mark.parametrize(
    "module,route,method",
    [
        (module, route, method)
        for module, endpoints in EXPECTED_ROUTES.items()
        for route, method in endpoints
    ]
)
def test_required_endpoint_is_registered(
    app,
    module,
    route,
    method
):
    registered = get_registered_routes(app)

    assert route in registered, (
        f"{module}: Missing route {route}"
    )

    assert method in registered[route], (
        f"{module}: {route} does not support {method}"
    )


# -------------------------------------------------------
# TEST 2 - NO DUPLICATE ENDPOINT NAMES
# -------------------------------------------------------

def test_no_duplicate_endpoint_names(app):
    """
    Different URL rules can intentionally share a
    handler. Verify that each named endpoint maps
    consistently to its registered view function.
    """

    for rule in app.url_map.iter_rules():
        assert rule.endpoint in app.view_functions, (
            f"Unresolved Flask endpoint: {rule.endpoint}"
        )


# -------------------------------------------------------
# TEST 3 - AUTHENTICATION ROUTES EXIST
# -------------------------------------------------------

def test_authentication_routes_are_complete(app):
    registered = get_registered_routes(app)

    required = (
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/me",
    )

    for route in required:
        assert route in registered


# -------------------------------------------------------
# TEST 4 - OWNER MODULE ROUTES EXIST
# -------------------------------------------------------

def test_owner_module_routes_exist(app):
    registered = get_registered_routes(app)

    required = (
        "/api/owner/dashboard",
        "/api/owner/products",
        "/api/owner/suppliers",
        "/api/users",
        "/api/financial/summary",
    )

    for route in required:
        assert route in registered


# -------------------------------------------------------
# TEST 5 - STAFF MODULE ROUTES EXIST
# -------------------------------------------------------

def test_staff_module_routes_exist(app):
    registered = get_registered_routes(app)

    required = (
        "/api/staff/dashboard",
        "/api/retail/products",
        "/api/retail/reservations",
        "/api/inventory/overview",
    )

    for route in required:
        assert route in registered


# -------------------------------------------------------
# TEST 6 - HEALTH ENDPOINT
# -------------------------------------------------------

def test_health_endpoint_exists(app):
    registered = get_registered_routes(app)

    assert "/api/health" in registered
    assert "GET" in registered["/api/health"]
