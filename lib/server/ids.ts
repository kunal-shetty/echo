const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True if `s` is a canonical uuid string. */
export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}
