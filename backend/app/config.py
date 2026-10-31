"""Environment loading and small config helpers.

Reads the repo-root `.env.local` / `.env` so the frontend and backend share
one env file. Real environment variables always win over file values.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]

if not os.getenv("ECHO_SKIP_DOTENV"):
    load_dotenv(ROOT / ".env.local")
    load_dotenv(ROOT / ".env")


def is_production() -> bool:
    return os.getenv("APP_ENV") == "production"


def groq_api_key() -> str | None:
    return os.getenv("GROQ_API_KEY") or None
