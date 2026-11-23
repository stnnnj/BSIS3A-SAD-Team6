
"""Stock-adjustment business transaction tests, using a FAKE database only."""

import pytest
import inventory


class StockCursor:
    def __init__(self, on_hand, fail_insert=False):
        self.on_hand = on_hand
        self.fail_insert = fail_insert
        self.commands = []
        self.lastrowid = 912

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params=None):
        self.commands.append(
            (" ".join(sql.split()), params)
        )

        if (
            self.fail_insert
            and "INSERT INTO inventory_transactions" in sql
        ):
            raise RuntimeError(
                "Simulated insert failure"
            )

    def fetchone(self):
        if self.on_hand is None:
            return None

        return {
            "current_qty": self.on_hand
        }


class StockConnection:
    def __init__(
        self,
        on_hand=10,
        fail_insert=False
    ):
        self.cursor_instance = StockCursor(
            on_hand,
            fail_insert
        )

        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


def request_stock_change(
    client,
    direction,
    quantity
):
    return client.post(
        "/api/owner/inventory/adjustments",
        json={
            "product_id": 7,
            "direction": direction,
            "quantity": quantity,
            "remarks": "Counted during test stocktake"
        }
    )


@pytest.mark.parametrize(
    "direction, quantity, expected_qty, txn_type",
    [
        ("in", 5, 15, "Manual In"),
        ("out", 3, 7, "Manual Out")
    ]
)
def test_stock_update_and_audit_insert_share_one_commit(
    owner_session,
    monkeypatch,
    direction,
    quantity,
    expected_qty,
    txn_type
):
    fake = StockConnection(on_hand=10)

    monkeypatch.setattr(
        inventory,
        "get_db_connection",
        lambda: fake
    )

    response = request_stock_change(
        owner_session,
        direction,
        quantity
    )

    assert response.status_code == 201, (
        response.get_json()
    )

    assert (
        response.get_json()["current_qty"]
        == expected_qty
    )

    statements = fake.cursor_instance.commands

    # SELECT FOR UPDATE, UPDATE stock, INSERT audit
    assert len(statements) == 3

    assert "FOR UPDATE" in statements[0][0]

    assert statements[1][1] == (
        expected_qty,
        7
    )

    assert (
        "inventory_transactions"
        in statements[2][0]
    )

    assert (
        statements[2][1][2]
        == txn_type
    )

    assert fake.commits == 1
    assert fake.rollbacks == 0
    assert fake.closed is True


def test_stock_out_rejected_if_insufficient(
    owner_session,
    monkeypatch
):
    fake = StockConnection(on_hand=2)

    monkeypatch.setattr(
        inventory,
        "get_db_connection",
        lambda: fake
    )

    response = request_stock_change(
        owner_session,
        "out",
        3
    )

    assert response.status_code == 409

    assert len(
        fake.cursor_instance.commands
    ) == 1

    assert fake.commits == 0
    assert fake.rollbacks >= 1
    assert fake.closed is True


def test_audit_insert_failure_does_not_commit_stock(
    owner_session,
    monkeypatch
):
    fake = StockConnection(
        on_hand=10,
        fail_insert=True
    )

    monkeypatch.setattr(
        inventory,
        "get_db_connection",
        lambda: fake
    )

    response = request_stock_change(
        owner_session,
        "in",
        2
    )

    assert response.status_code == 503
    assert fake.commits == 0
    assert fake.rollbacks == 1
    assert fake.closed is True
