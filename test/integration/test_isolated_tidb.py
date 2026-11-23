
"""
CCMC RetailFlow - Isolated TiDB Integration Testing

Purpose:
- Verify isolated test database connection
- Verify database identity
- Check all 10 required tables
- Verify tables can be read

SAFETY:
- Read-only SQL statements
- No INSERT, UPDATE, or DELETE
- Requires explicit opt-in
- Rejects the main ccmc_retailflow database

Do not configure these tests with production
credentials or a shared database.
"""

import os
import re
import ssl

from pathlib import Path

import pytest


pytestmark = pytest.mark.integration


# -------------------------------------------------------
# EXPECTED DATABASE TABLES
# -------------------------------------------------------

EXPECTED_TABLES = {
    "users",
    "categories",
    "suppliers",
    "products",
    "sales",
    "sale_items",
    "orders",
    "order_items",
    "returns",
    "inventory_transactions",
}


# -------------------------------------------------------
# ISOLATED DATABASE CONNECTION FIXTURE
# -------------------------------------------------------

@pytest.fixture(scope="module")
def isolated_connection():

    # Require explicit permission.
    if os.getenv("RUN_ISOLATED_DB_TESTS") != "YES":
        pytest.skip(
            "Isolated database tests are disabled. "
            "Set RUN_ISOLATED_DB_TESTS=YES to enable."
        )

    required = (
        "TEST_TIDB_HOST",
        "TEST_TIDB_PORT",
        "TEST_TIDB_USER",
        "TEST_TIDB_PASSWORD",
        "TEST_TIDB_DATABASE",
        "TEST_TIDB_CA_PATH",
    )

    missing = [
        name
        for name in required
        if not os.getenv(name)
    ]

    if missing:
        pytest.fail(
            "Missing isolated database settings: "
            + ", ".join(missing)
        )

    # ---------------------------------------------------
    # DATABASE SAFETY CHECK
    # ---------------------------------------------------

    database = os.environ["TEST_TIDB_DATABASE"]

    production = os.getenv(
        "TIDB_DATABASE",
        "ccmc_retailflow"
    )

    if (
        database.lower() == production.lower()
        or database.lower() == "ccmc_retailflow"
    ):
        pytest.fail(
            "Refusing to connect to the production "
            "CCMC RetailFlow database."
        )

    if not re.fullmatch(
        r"(?:test_[a-zA-Z0-9_]+|[a-zA-Z0-9_]+_test)",
        database
    ):
        pytest.fail(
            "Test database name must begin with "
            "'test_' or end with '_test'."
        )

    # ---------------------------------------------------
    # VERIFY CA CERTIFICATE
    # ---------------------------------------------------

    ca_path = Path(
        os.environ["TEST_TIDB_CA_PATH"]
    )

    if not ca_path.is_file():
        pytest.fail(
            "The test database CA certificate "
            "file does not exist."
        )

    # ---------------------------------------------------
    # CONNECT TO ISOLATED TIDB
    # ---------------------------------------------------

    import pymysql

    ssl_context = ssl.create_default_context(
        cafile=str(ca_path)
    )

    connection = pymysql.connect(
        host=os.environ["TEST_TIDB_HOST"],
        port=int(
            os.environ["TEST_TIDB_PORT"]
        ),
        user=os.environ["TEST_TIDB_USER"],
        password=os.environ["TEST_TIDB_PASSWORD"],
        database=database,
        charset="utf8mb4",
        connect_timeout=10,
        read_timeout=10,
        write_timeout=10,
        ssl=ssl_context,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )

    try:
        yield connection

    finally:
        connection.rollback()
        connection.close()


# -------------------------------------------------------
# TEST 1 - DATABASE CONNECTION AND IDENTITY
# -------------------------------------------------------

def test_isolated_db_connection_and_identity(
    isolated_connection
):
    """
    Verify that the isolated test database
    is connected and identifies itself.
    """

    with isolated_connection.cursor() as cursor:

        cursor.execute(
            "SELECT DATABASE() AS database_name, "
            "1 AS healthy"
        )

        result = cursor.fetchone()

    assert result["healthy"] == 1

    assert (
        result["database_name"]
        == os.environ["TEST_TIDB_DATABASE"]
    )


# -------------------------------------------------------
# TEST 2 - REQUIRED TABLES
# -------------------------------------------------------

def test_all_ten_required_tables_exist(
    isolated_connection
):
    """
    Verify that the test database contains
    all 10 CCMC RetailFlow tables.
    """

    with isolated_connection.cursor() as cursor:

        cursor.execute("SHOW TABLES")

        tables = {
            next(iter(record.values()))
            for record in cursor.fetchall()
        }

    missing_tables = EXPECTED_TABLES - tables

    assert EXPECTED_TABLES <= tables, (
        "Missing tables: "
        + str(sorted(missing_tables))
    )


# -------------------------------------------------------
# TEST 3 - TABLE READABILITY
# -------------------------------------------------------

@pytest.mark.parametrize(
    "table",
    sorted(EXPECTED_TABLES)
)
def test_can_read_existing_test_table(
    isolated_connection,
    table
):
    """
    Verify each expected table can be queried.

    Table names come from a predefined allowlist,
    not from user input.
    """

    with isolated_connection.cursor() as cursor:

        cursor.execute(
            f"SELECT COUNT(*) AS total FROM `{table}`"
        )

        result = cursor.fetchone()

    assert int(result["total"]) >= 0