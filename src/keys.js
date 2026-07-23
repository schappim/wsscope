import { getPublicKey, nip19 } from 'nostr-tools'

const HEX64 = /^[0-9a-f]{64}$/i

/**
 * Accept an `nsec1…` bech32 key or a 64-char hex key and normalise it.
 * Returns { secret: Uint8Array, pubkey: hex, npub: string }.
 */
export function parseSecretKey(input) {
  const value = String(input ?? '').trim()
  if (!value) throw new Error('empty secret key')

  let secret
  if (value.startsWith('nsec1')) {
    const { type, data } = nip19.decode(value)
    if (type !== 'nsec') throw new Error(`expected an nsec key, got ${type}`)
    secret = data
  } else if (HEX64.test(value)) {
    secret = hexToBytes(value)
  } else {
    throw new Error('secret key must be nsec1… or 64 hex characters')
  }

  const pubkey = getPublicKey(secret)
  return { secret, pubkey, npub: nip19.npubEncode(pubkey) }
}

/**
 * Resolve a secret key from the CLI flag, then the environment.
 * Returns null when no key was supplied — the CLI stays usable read-only.
 */
export function resolveSecretKey(flagValue, env = process.env) {
  const raw = flagValue ?? env.WSSCOPE_SEC ?? env.NOSTR_SEC ?? null
  if (!raw) return null
  return parseSecretKey(raw)
}

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** Shorten a hex pubkey for display: `a1b2c3d4…9f8e7d6c`. */
export function shortHex(hex, head = 8, tail = 8) {
  const value = String(hex ?? '')
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/** Best-effort npub for display; falls back to shortened hex. */
export function shortNpub(pubkeyHex) {
  try {
    const npub = nip19.npubEncode(pubkeyHex)
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`
  } catch {
    return shortHex(pubkeyHex)
  }
}
