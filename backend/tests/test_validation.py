from datetime import datetime, timezone

from app.queries import range_bounds, sanitize_filter_text
from app.rate_limit import take_token
from app.shape import money
from app.transaction_input import TxContext, parse_amount, validate_transaction_input

CAT = "44444444-4444-4444-8444-444444444444"
CTX = TxContext(
    account_id="acct-own",
    home_currency="INR",
    category_ids={CAT},
    category_id_by_name={"food": CAT},
)


def validate(raw):
    return validate_transaction_input(
        raw, CTX, allowed_sources=("manual", "voice"), default_source="manual"
    )


def test_always_uses_the_server_resolved_account():
    row, _ = validate({"amount_minor": 100, "merchant_raw": "Cafe", "account_id": "someone-elses"})
    assert row["account_id"] == "acct-own"


def test_rejects_categories_the_user_cant_see():
    assert validate({"amount_minor": 100, "merchant_raw": "Cafe", "category_id": "not-mine"}) == (
        None,
        "Unknown category",
    )


def test_resolves_a_category_by_name():
    row, _ = validate({"amount_minor": 100, "merchant_raw": "Cafe", "category_name": " Food "})
    assert row["category_id"] == CAT


def test_coerces_disallowed_sources_and_drops_voice_only_fields():
    row, _ = validate(
        {
            "amount_minor": 100,
            "merchant_raw": "Cafe",
            "source": "recurring",
            "confidence": 0.9,
            "raw_transcript": "x",
        }
    )
    assert row["source"] == "manual"
    assert row["confidence"] is None
    assert row["raw_transcript"] is None


def test_normalizes_currency_direction_and_lengths():
    row, _ = validate(
        {
            "amount_minor": 100,
            "merchant_raw": "M" * 500,
            "currency": "usd",
            "direction": "sideways",
            "note": "n" * 900,
        }
    )
    assert row["currency"] == "USD"
    assert row["direction"] == "expense"
    assert len(row["merchant_raw"]) == 200
    assert len(row["note"]) == 500


def test_rejects_bad_amounts_and_missing_merchants():
    assert validate({"amount_minor": 0, "merchant_raw": "x"})[0] is None
    assert validate({"amount_minor": "100", "merchant_raw": "x"})[0] is None
    assert validate({"amount_minor": True, "merchant_raw": "x"})[0] is None
    assert validate({"amount_minor": 10, "merchant_raw": "  "})[0] is None


def test_parses_dates_like_the_old_api():
    row, _ = validate({"amount_minor": 1, "merchant_raw": "x", "date": "2026-08-19"})
    assert row["transacted_at"] == "2026-08-19T00:00:00.000Z"
    row, _ = validate(
        {"amount_minor": 1, "merchant_raw": "x", "transacted_at": "2026-08-19T14:12:00+05:30"}
    )
    assert row["transacted_at"] == "2026-08-19T08:42:00.000Z"


def test_parse_amount_rounds_half_up_to_whole_units():
    assert parse_amount(12.5) == 13
    assert parse_amount(150) == 150
    assert parse_amount(-1) is None
    assert parse_amount(float("inf")) is None
    assert parse_amount(0.2) is None
    assert parse_amount(1e15) is None


def test_sanitize_filter_text_strips_quote_breakers():
    out = sanitize_filter_text('x",user_id.neq.0,"%_*\\')
    assert not any(ch in out for ch in '"\\%_*')


def test_sanitize_filter_text_keeps_ordinary_names():
    assert sanitize_filter_text("Amazon.in") == "Amazon.in"
    assert sanitize_filter_text("  Tim  Hortons ") == "Tim Hortons"


def test_rate_limiter_blocks_after_the_limit():
    for _ in range(3):
        assert take_token("k", 3, 60)
    assert not take_token("k", 3, 60)
    assert take_token("other", 3, 60)


def test_money_uses_indian_grouping():
    assert money(1200) == "₹1,200.00"
    assert money(123456.5) == "₹1,23,456.50"
    assert money(12345678) == "₹1,23,45,678.00"
    assert money(999) == "₹999.00"


def test_range_bounds_use_ist_days():
    # 20:00 UTC on Sun 30 Aug is already Mon 31 Aug in IST.
    now = datetime(2026, 8, 30, 20, 0, tzinfo=timezone.utc)
    start, end = range_bounds("today", now)
    assert start == datetime(2026, 8, 30, 18, 30, tzinfo=timezone.utc)
    assert end == datetime(2026, 8, 31, 18, 30, tzinfo=timezone.utc)
    week_start, _ = range_bounds("this_week", now)
    assert week_start == start  # Monday
    last_start, last_end = range_bounds("last_month", datetime(2026, 1, 10, tzinfo=timezone.utc))
    assert last_start == datetime(2025, 11, 30, 18, 30, tzinfo=timezone.utc)
    assert last_end == datetime(2025, 12, 31, 18, 30, tzinfo=timezone.utc)
    assert range_bounds("all", now) is None
