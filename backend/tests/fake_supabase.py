"""A minimal stand-in for the Supabase client.

Every `table(name)` call returns a chainable builder that records each
method call and, on `execute()`, returns the next scripted result for that
table (or an empty result once the script runs out). `rpc(fn, args)` works
the same way, keyed by function name. A scripted `error` is raised.
"""

import json
from dataclasses import dataclass, field
from typing import Any


class FakeAPIError(Exception):
    def __init__(self, error: dict[str, Any]):
        super().__init__(error.get("message", "error"))
        self.message = error.get("message")
        self.code = error.get("code")
        self.details = error.get("details")


@dataclass
class Result:
    data: Any = None
    count: int | None = None


@dataclass
class RecordedQuery:
    table: str
    ops: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = field(default_factory=list)


class _Builder:
    def __init__(self, fake: "FakeSupabase", entry: RecordedQuery, queue: list[dict[str, Any]]):
        self._fake = fake
        self._entry = entry
        self._queue = queue

    def __getattr__(self, method: str):
        def record(*args: Any, **kwargs: Any) -> "_Builder":
            self._entry.ops.append((method, args, kwargs))
            return self

        return record

    def execute(self) -> Result:
        scripted = self._queue.pop(0) if self._queue else {}
        if scripted.get("error"):
            raise FakeAPIError(scripted["error"])
        return Result(data=scripted.get("data"), count=scripted.get("count"))


class FakeSupabase:
    def __init__(
        self,
        tables: dict[str, list[dict[str, Any]]] | None = None,
        rpcs: dict[str, list[dict[str, Any]]] | None = None,
    ):
        self._tables = {k: list(v) for k, v in (tables or {}).items()}
        self._rpcs = {k: list(v) for k, v in (rpcs or {}).items()}
        self.queries: list[RecordedQuery] = []
        self.rpc_calls: list[tuple[str, Any]] = []

    def table(self, name: str) -> _Builder:
        entry = RecordedQuery(name)
        self.queries.append(entry)
        return _Builder(self, entry, self._tables.setdefault(name, []))

    def rpc(self, fn: str, args: Any) -> _Builder:
        self.rpc_calls.append((fn, args))
        return _Builder(self, RecordedQuery(f"rpc:{fn}"), self._rpcs.setdefault(fn, []))

    def on(self, table: str) -> list[RecordedQuery]:
        """All recorded queries against `table`."""
        return [q for q in self.queries if q.table == table]

    def called(self, table: str, method: str, *args: Any) -> bool:
        """True if some query against `table` called `method` starting with these args."""
        want = json.dumps(list(args), default=str)
        return any(
            m == method and json.dumps(list(a[: len(args)]), default=str) == want
            for q in self.on(table)
            for m, a, _ in q.ops
        )
