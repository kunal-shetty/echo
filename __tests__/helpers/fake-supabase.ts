/**
 * A minimal stand-in for the Supabase client used in route/unit tests.
 *
 * Every `from(table)` call returns a chainable builder that records each
 * method call and, when awaited, resolves to the next scripted result for
 * that table (or `{ data: null, error: null }` once the script runs out).
 * `rpc(fn, args)` works the same way, keyed by function name.
 */

export interface FakeResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

export interface RecordedQuery {
  table: string;
  ops: Array<[method: string, args: unknown[]]>;
}

export function fakeSupabase(
  tables: Record<string, FakeResult[]> = {},
  rpcs: Record<string, FakeResult[]> = {},
) {
  const queries: RecordedQuery[] = [];
  const rpcCalls: Array<[fn: string, args: unknown]> = [];
  const next = (queue: FakeResult[] | undefined): FakeResult =>
    queue?.shift() ?? { data: null, error: null };

  function builder(table: string) {
    const entry: RecordedQuery = { table, ops: [] };
    queries.push(entry);
    let result: FakeResult | null = null;
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            result ??= next(tables[table]);
            const settled = Promise.resolve(result);
            return settled.then.bind(settled);
          }
          return (...args: unknown[]) => {
            entry.ops.push([String(prop), args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push([fn, args]);
      return Promise.resolve(next(rpcs[fn]));
    },
  };

  return {
    client,
    queries,
    rpcCalls,
    /** All recorded queries against `table`. */
    on: (table: string) => queries.filter((q) => q.table === table),
    /** True if some query against `table` called `method` with these args. */
    called: (table: string, method: string, ...args: unknown[]) =>
      queries.some(
        (q) =>
          q.table === table &&
          q.ops.some(
            ([m, a]) =>
              m === method && JSON.stringify(a.slice(0, args.length)) === JSON.stringify(args),
          ),
      ),
  };
}

/** A fake `cookies()` store backed by a plain object. */
export function fakeCookies(initial: Record<string, string> = {}) {
  const jar = { ...initial };
  return {
    jar,
    store: {
      get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined),
      set: (name: string, value: string, _opts?: unknown) => {
        jar[name] = value;
      },
      delete: (name: string) => {
        delete jar[name];
      },
    },
  };
}
