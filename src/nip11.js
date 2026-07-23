/**
 * NIP-11 — fetch a relay's information document over plain HTTP(S).
 */

/** wss://host/path -> https://host/path (ws:// -> http://). */
export function toHttpUrl(wsUrl) {
  const url = new URL(wsUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  return url.toString()
}

/**
 * Fetch the relay information document.
 * Returns null rather than throwing — a missing NIP-11 doc is not fatal,
 * plenty of relays simply don't serve one.
 */
export async function fetchRelayInfo(wsUrl, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(toHttpUrl(wsUrl), {
      headers: { Accept: 'application/nostr+json' },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!res.ok) return null
    const text = await res.text()
    return JSON.parse(text)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
