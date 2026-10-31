"""Transactions: list, manual create, bulk import, legacy migration, edit, delete."""

import re
from typing import Any

from fastapi import APIRouter, Body, Request, Response

from app import transactions as tx
from app.categories import list_categories_for_user
from app.db import is_supabase_configured
from app.http import ApiError, as_object
from app.ids import is_uuid
from app.shape import index_categories, to_ui_transaction
from app.timeutil import iso, parse_datetime
from app.transaction_input import load_tx_context, parse_amount, validate_transaction_input
from app.user import get_current_user_id, require_user_id

router = APIRouter(prefix="/api/transactions")

MAX_BULK_ROWS = 500
MAX_MIGRATE_ROWS = 1000

# Fields a client may edit. `source` is intentionally excluded per product
# decision; direction is editable so a memory can flip expense/income.
ALLOWED_KEYS = {
    "amount_minor",
    "currency",
    "merchant_raw",
    "merchant_canonical",
    "category_id",
    "note",
    "transacted_at",
    "direction",
}
FORBIDDEN_KEYS = {
    "id",
    "user_id",
    "account_id",
    "created_at",
    "source",
    "confidence",
    "raw_transcript",
    "clarified",
    "deleted_at",
}


def _require_backend() -> None:
    if not is_supabase_configured():
        raise ApiError(503, "Backend not configured.")


def _ui_rows(user_id: str, db_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cats = index_categories(list_categories_for_user(user_id))
    return [to_ui_transaction(r, cats) for r in db_rows]


@router.get("")
def list_all(request: Request):
    """The session user's transactions; no session simply means none yet."""
    if not is_supabase_configured():
        return {"transactions": [], "configured": False}
    user_id = get_current_user_id(request)
    if not user_id:
        return {"transactions": [], "configured": True}
    return {
        "transactions": _ui_rows(user_id, tx.list_transactions(user_id, 500)),
        "configured": True,
    }


@router.post("")
def create(request: Request, body: Any = Body(None)):
    """Manually creates a transaction (creating a guest on first use). The
    account is always the user's default; every other field is validated."""
    _require_backend()
    raw = as_object(body)
    user_id = require_user_id(request)
    ctx = load_tx_context(user_id)
    row, error = validate_transaction_input(
        raw, ctx, allowed_sources=("manual", "voice"), default_source="manual"
    )
    if error:
        raise ApiError(400, error)
    created = tx.create_transaction(user_id, row)
    return {"transaction": _ui_rows(user_id, [created])[0]}


@router.post("/bulk")
def bulk(request: Request, body: Any = Body(None)):
    """Imports many rows; inserts the valid ones and reports the failures."""
    _require_backend()
    rows = body.get("rows") if isinstance(body, dict) else None
    rows = rows if isinstance(rows, list) else []
    if not rows:
        raise ApiError(400, "No rows to import")
    if len(rows) > MAX_BULK_ROWS:
        raise ApiError(400, f"Too many rows (max {MAX_BULK_ROWS})")

    user_id = require_user_id(request)
    ctx = load_tx_context(user_id)
    valid: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for idx, r in enumerate(rows):
        if not isinstance(r, dict):
            failures.append({"rowIndex": idx, "error": "Invalid row"})
            continue
        row, error = validate_transaction_input(
            r, ctx, allowed_sources=("import",), default_source="import"
        )
        if error:
            failures.append({"rowIndex": idx, "error": error})
        else:
            valid.append(row)

    inserted = _ui_rows(user_id, tx.bulk_create_transactions(user_id, valid)) if valid else []
    return {"inserted": len(inserted), "transactions": inserted, "failures": failures}


# camelCase UI field → snake_case input field, for migrated rows.
_MIGRATE_FIELDS = {
    "amountMinor": "amount_minor",
    "currency": "currency",
    "direction": "direction",
    "merchantRaw": "merchant_raw",
    "merchantCanonical": "merchant_canonical",
    "categoryName": "category_name",
    "note": "note",
    "transactedAt": "transacted_at",
    "source": "source",
    "confidence": "confidence",
    "rawTranscript": "raw_transcript",
}


@router.post("/migrate")
def migrate(request: Request, body: Any = Body(None)):
    """One-time upload of rows older app versions kept in localStorage.
    Rows arrive in the UI (camelCase) shape and get the usual validation."""
    _require_backend()
    items = body.get("transactions") if isinstance(body, dict) else None
    if not isinstance(items, list):
        raise ApiError(400, "Invalid input: transactions must be an array.")
    if len(items) > MAX_MIGRATE_ROWS:
        raise ApiError(400, f"Too many rows (max {MAX_MIGRATE_ROWS})")

    user_id = require_user_id(request)
    ctx = load_tx_context(user_id)
    valid: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for idx, t in enumerate(items):
        t = t if isinstance(t, dict) else {}
        raw = {dst: t[src] for src, dst in _MIGRATE_FIELDS.items() if src in t}
        # Local category ids may not exist server-side; fall back to the name.
        if isinstance(t.get("categoryId"), str) and t["categoryId"] in ctx.category_ids:
            raw["category_id"] = t["categoryId"]
        row, error = validate_transaction_input(
            raw, ctx, allowed_sources=("voice", "manual", "import"), default_source="import"
        )
        if error:
            failures.append({"rowIndex": idx, "error": error})
        else:
            valid.append(row)

    inserted = tx.bulk_create_transactions(user_id, valid)
    return {"success": True, "inserted": len(inserted), "failures": failures}


@router.patch("/{tx_id}")
def update(tx_id: str, request: Request, body: Any = Body(None)):
    _require_backend()
    user_id = get_current_user_id(request)
    if not user_id:
        raise ApiError(401, "Unauthorized.")
    if not is_uuid(tx_id):
        raise ApiError(404, "Not found")
    raw = as_object(body)

    for key in raw:
        if key in FORBIDDEN_KEYS:
            raise ApiError(400, f"Field '{key}' is not editable")
        if key not in ALLOWED_KEYS:
            raise ApiError(400, f"Unknown field '{key}'")

    patch: dict[str, Any] = {}
    if "amount_minor" in raw:
        amount = parse_amount(raw["amount_minor"])
        if amount is None:
            raise ApiError(400, "amount_minor must be a positive number")
        patch["amount_minor"] = amount
    if "currency" in raw:
        currency = raw["currency"]
        if not isinstance(currency, str) or not re.fullmatch(r"[A-Za-z]{3}", currency):
            raise ApiError(400, "currency must be a 3-letter code")
        patch["currency"] = currency.upper()
    if "merchant_raw" in raw:
        merchant = str(raw["merchant_raw"] or "").strip()[:200]
        if not merchant:
            raise ApiError(400, "merchant_raw is required")
        patch["merchant_raw"] = merchant
    if "merchant_canonical" in raw:
        canonical = raw["merchant_canonical"]
        patch["merchant_canonical"] = (
            None if canonical is None else (str(canonical).strip()[:200] or None)
        )
    if "category_id" in raw:
        cat = raw["category_id"]
        if cat is not None and not is_uuid(cat):
            raise ApiError(400, "category_id must be a uuid or null")
        patch["category_id"] = cat
    if "note" in raw:
        note = raw["note"]
        if note is not None:
            note = str(note)
            if len(note) > 500:
                raise ApiError(400, "note must be 500 characters or fewer")
        patch["note"] = note
    if "transacted_at" in raw:
        when = raw["transacted_at"]
        if not isinstance(when, str):
            raise ApiError(400, "transacted_at must be a string")
        parsed = parse_datetime(when)
        if parsed is None:
            raise ApiError(400, "transacted_at is not a valid date")
        patch["transacted_at"] = iso(parsed)
    if "direction" in raw:
        if raw["direction"] not in ("expense", "income"):
            raise ApiError(400, "direction must be 'expense' or 'income'")
        patch["direction"] = raw["direction"]

    if not patch:
        raise ApiError(400, "Nothing to update")

    if patch.get("category_id"):
        known = any(c["id"] == patch["category_id"] for c in list_categories_for_user(user_id))
        if not known:
            raise ApiError(400, "Unknown category")

    updated = tx.update_transaction(user_id, tx_id, patch)
    if not updated:
        raise ApiError(404, "Not found")
    return {"transaction": _ui_rows(user_id, [updated])[0]}


@router.delete("/{tx_id}", status_code=204)
def delete(tx_id: str, request: Request):
    _require_backend()
    user_id = get_current_user_id(request)
    if not user_id:
        raise ApiError(401, "Unauthorized.")
    if not is_uuid(tx_id) or not tx.delete_transaction(user_id, tx_id):
        raise ApiError(404, "Not found")
    return Response(status_code=204)
