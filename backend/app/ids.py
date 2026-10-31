import re
from typing import Any

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)


def is_uuid(s: Any) -> bool:
    """True if `s` is a canonical uuid string."""
    return isinstance(s, str) and bool(_UUID_RE.match(s))
