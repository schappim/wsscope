import { nip19 } from 'nostr-tools'

const DURATION = /^(\d+)([smhdw])$/i
const SECONDS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }

/**
 * `2h` / `30m` / `7d` -> unix seconds relative to now.
 * A bare integer is treated as an absolute unix timestamp.
 */
export function parseTime(input, now = Math.floor(Date.now() / 1000)) {
  const value = String(input).trim()
  const match = DURATION.exec(value)
  if (match) return now - Number(match[1]) * SECONDS[match[2].toLowerCase()]
  if (/^\d+$/.test(value)) return Number(value)
  throw new Error(`invalid time "${input}" — use 30m, 2h, 7d or a unix timestamp`)
}

/** Accept npub1… or 64-char hex, return hex. */
export function parsePubkey(input) {
  const value = String(input).trim()
  if (value.startsWith('npub1')) {
    const { type, data } = nip19.decode(value)
    if (type !== 'npub') throw new Error(`expected npub, got ${type}`)
    return data
  }
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase()
  throw new Error(`invalid pubkey "${input}" — use npub1… or 64 hex characters`)
}

function splitList(value) {
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Turn CLI flags into an array of NIP-01 filters.
 *
 * `--filter '<json>'` entries are used verbatim (repeatable). Any of the
 * convenience flags are merged into one additional filter. When nothing at
 * all is supplied the caller gets `[]` and decides on a default.
 */
export function buildFilters(opts = {}) {
  const filters = []

  for (const raw of opts.filter ?? []) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(`--filter is not valid JSON: ${err.message}`)
    }
    if (Array.isArray(parsed)) filters.push(...parsed)
    else if (parsed && typeof parsed === 'object') filters.push(parsed)
    else throw new Error('--filter must be a JSON object or array of objects')
  }

  const shorthand = {}
  if (opts.kinds) {
    shorthand.kinds = splitList(opts.kinds).map((k) => {
      const n = Number(k)
      if (!Number.isInteger(n)) throw new Error(`invalid kind "${k}"`)
      return n
    })
  }
  if (opts.author) shorthand.authors = opts.author.flatMap(splitList).map(parsePubkey)
  if (opts.mention) shorthand['#p'] = opts.mention.flatMap(splitList).map(parsePubkey)
  if (opts.group) shorthand['#h'] = opts.group.flatMap(splitList)
  if (opts.id) shorthand.ids = opts.id.flatMap(splitList)
  if (opts.search) shorthand.search = opts.search
  if (opts.since) shorthand.since = parseTime(opts.since)
  if (opts.until) shorthand.until = parseTime(opts.until)
  if (opts.limit !== undefined) {
    const n = Number(opts.limit)
    if (!Number.isInteger(n) || n < 0) throw new Error(`invalid --limit "${opts.limit}"`)
    shorthand.limit = n
  }

  for (const entry of opts.tag ?? []) {
    const eq = entry.indexOf('=')
    if (eq < 1) throw new Error(`--tag must look like name=value (got "${entry}")`)
    const name = entry.slice(0, eq)
    const values = splitList(entry.slice(eq + 1))
    const key = name.startsWith('#') ? name : `#${name}`
    shorthand[key] = [...(shorthand[key] ?? []), ...values]
  }

  if (Object.keys(shorthand).length > 0) filters.push(shorthand)
  return filters
}

/** Short, stable subscription ids: sub1, sub2, … */
export function subscriptionIdFactory(prefix = 'sub') {
  let n = 0
  return () => `${prefix}${++n}`
}
