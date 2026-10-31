from unittest.mock import MagicMock

import pytest

from app import transactions as tx
from app.routes import transactions as routes
from app.transaction_input import TxContext

CAT = "44444444-4444-4444-8444-444444444444"


@pytest.fixture
def mocks(monkeypatch):
    m = {
        "create_transaction": MagicMock(side_effect=lambda _uid, row: {"id": "tx-1", **row}),
        "list_transactions": MagicMock(return_value=[]),
        "require_user_id": MagicMock(return_value="test-user-id"),
        "get_current_user_id": MagicMock(return_value="test-user-id"),
        "load_tx_context": MagicMock(
            return_value=TxContext(
                account_id="own-default-account",
                home_currency="INR",
                category_ids={CAT},
                category_id_by_name={"food": CAT},
            )
        ),
        "_ui_rows": MagicMock(side_effect=lambda _uid, rows: [{**r, "ui": True} for r in rows]),
    }
    monkeypatch.setattr(tx, "create_transaction", m["create_transaction"])
    monkeypatch.setattr(tx, "list_transactions", m["list_transactions"])
    for name in ("require_user_id", "get_current_user_id", "load_tx_context", "_ui_rows"):
        monkeypatch.setattr(routes, name, m[name])
    return m


def post(client, body):
    return client.post("/api/transactions", json=body)


def test_503_when_supabase_is_not_configured(client, mocks, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    res = post(client, {"amount_minor": 100, "merchant_raw": "Coffee"})
    assert res.status_code == 503
    assert res.json()["error"] == "Backend not configured."


def test_400_for_non_positive_amounts(client, mocks):
    res = post(client, {"amount_minor": 0, "merchant_raw": "Coffee"})
    assert res.status_code == 400
    assert res.json()["error"] == "Amount must be > 0"


def test_400_without_a_merchant(client, mocks):
    res = post(client, {"amount_minor": 100})
    assert res.status_code == 400
    assert res.json()["error"] == "Merchant is required"


def test_400_for_invalid_json(client, mocks):
    res = client.post(
        "/api/transactions", content="{nope", headers={"content-type": "application/json"}
    )
    assert res.status_code == 400
    assert res.json()["error"] == "Invalid JSON body"


def test_ignores_a_client_supplied_account_id(client, mocks):
    res = post(
        client,
        {"amount_minor": 100, "merchant_raw": "Coffee", "account_id": "someone-elses-account"},
    )
    assert res.status_code == 200
    _, row = mocks["create_transaction"].call_args.args
    assert row["account_id"] == "own-default-account"


def test_rejects_a_category_the_user_does_not_own(client, mocks):
    res = post(client, {"amount_minor": 100, "merchant_raw": "Coffee", "category_id": "foreign"})
    assert res.status_code == 400
    mocks["create_transaction"].assert_not_called()


def test_normalizes_currency_direction_and_source(client, mocks):
    post(
        client,
        {
            "amount_minor": 500,
            "merchant_raw": "Salary",
            "currency": "usd",
            "direction": "income",
            "source": "recurring",
            "category_id": CAT,
        },
    )
    user_id, row = mocks["create_transaction"].call_args.args
    assert user_id == "test-user-id"
    assert row["currency"] == "USD"
    assert row["direction"] == "income"
    assert row["source"] == "manual"
    assert row["category_id"] == CAT


def test_creates_a_guest_identity_on_first_write(client, mocks):
    post(client, {"amount_minor": 100, "merchant_raw": "Coffee"})
    mocks["require_user_id"].assert_called_once()


def test_get_without_a_session_never_creates_one(client, mocks):
    mocks["get_current_user_id"].return_value = None
    res = client.get("/api/transactions")
    assert res.json() == {"transactions": [], "configured": True}
    mocks["list_transactions"].assert_not_called()
    mocks["require_user_id"].assert_not_called()


def test_get_lists_only_the_session_users_transactions(client, mocks):
    client.get("/api/transactions")
    mocks["list_transactions"].assert_called_once_with("test-user-id", 500)


def test_patch_rejects_immutable_fields(client, mocks):
    res = client.patch(f"/api/transactions/{CAT}", json={"source": "voice"})
    assert res.status_code == 400
    assert res.json()["error"] == "Field 'source' is not editable"


def test_patch_requires_a_session(client, mocks):
    mocks["get_current_user_id"].return_value = None
    res = client.patch(f"/api/transactions/{CAT}", json={"amount_minor": 5})
    assert res.status_code == 401


def test_migrate_maps_ui_rows_and_falls_back_to_category_names(client, mocks, monkeypatch):
    inserted = MagicMock(side_effect=lambda _uid, rows: rows)
    monkeypatch.setattr(tx, "bulk_create_transactions", inserted)
    res = client.post(
        "/api/transactions/migrate",
        json={
            "transactions": [
                {
                    "amountMinor": 120,
                    "merchantRaw": "Chai",
                    "categoryId": "local-only-id",
                    "categoryName": "Food",
                    "source": "voice",
                },
                {"amountMinor": 0, "merchantRaw": "Bad"},
            ]
        },
    )
    assert res.json() == {
        "success": True,
        "inserted": 1,
        "failures": [{"rowIndex": 1, "error": "Amount must be > 0"}],
    }
    [row] = inserted.call_args.args[1]
    assert row["category_id"] == CAT
    assert row["merchant_canonical"] == "Chai"
    assert row["source"] == "voice"
