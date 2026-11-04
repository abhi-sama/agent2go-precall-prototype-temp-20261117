/**
 * The `next` parameter as a same-origin path, or null. Resolved against this origin rather than
 * string-checked, so `//host`, `/\host`, `javascript:` and encoded variants cannot redirect away.
 */
export function safeNext(next: string | null, origin: string): string | null {
  if (!next || /[\\\u0000-\u001f]/.test(next)) return null
  try {
    const url = new URL(next, origin)
    if (url.origin !== origin || url.pathname === "/login") return null
    const out = `${url.pathname}${url.search}${url.hash}`
    // Dot segments can normalize to a protocol-relative path ("/.//host" -> "//host").
    return out.startsWith("/") && !out.startsWith("//") ? out : null
  } catch {
    return null
  }
}
