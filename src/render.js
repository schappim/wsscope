import { c, displayWidth } from './colors.js'
import { describeKind, kindClass } from './kinds.js'
import { shortHex, shortNpub } from './keys.js'

const IN = '←'
const OUT = '→'
const NOTE = '•'

export function timestamp(date = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** `2026-07-24 08:55:01` from a unix seconds timestamp. */
export function formatUnix(seconds) {
  if (!Number.isFinite(seconds)) return '?'
  const d = new Date(seconds * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function humanBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function humanDuration(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Collapse newlines and clip to `max` display characters. */
export function oneLine(text, max = 120) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}

export class Renderer {
  constructor({ out = process.stdout, verbose = false, contentWidth = 140, showTags = false } = {}) {
    this.out = out
    this.verbose = verbose
    this.contentWidth = contentWidth
    this.showTags = showTags
  }

  write(line) {
    this.out.write(`${line}\n`)
  }

  /** A dim timestamp gutter every line shares. */
  gutter(arrow, arrowColor = c.gray) {
    return `${c.gray(timestamp())} ${arrowColor(arrow)}`
  }

  /** Client-side status line: connecting, reconnecting, errors, hints. */
  status(text, { level = 'info' } = {}) {
    const paint =
      level === 'error' ? c.brightRed : level === 'warn' ? c.yellow : level === 'good' ? c.green : c.cyan
    this.write(`${this.gutter(NOTE, paint)} ${paint(text)}`)
  }

  banner(lines) {
    for (const line of lines) this.write(line)
  }

  outbound(raw) {
    let label = raw
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) label = this.#summariseOutbound(parsed, raw)
    } catch {
      // Not JSON — show it as typed.
    }
    this.write(`${this.gutter(OUT, c.brightBlue)} ${label}`)
  }

  raw(text, direction = 'in') {
    const arrow = direction === 'in' ? IN : OUT
    const paint = direction === 'in' ? c.gray : c.brightBlue
    this.write(`${this.gutter(arrow, paint)} ${c.dim(text)}`)
  }

  /** Render one inbound protocol frame. `parsed` is null for non-JSON payloads. */
  inbound(raw, parsed) {
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') {
      this.write(`${this.gutter(IN)} ${c.dim(oneLine(raw, this.contentWidth))}`)
      return
    }

    const [type, ...rest] = parsed
    switch (type) {
      case 'EVENT':
        this.#renderEvent(rest[0], rest[1])
        break
      case 'AUTH':
        this.write(
          `${this.gutter(IN, c.yellow)} ${c.yellow(c.bold('AUTH'))} ${c.dim('challenge')} ${c.white(String(rest[0]))}`,
        )
        break
      case 'EOSE':
        this.write(
          `${this.gutter(IN, c.magenta)} ${c.magenta('EOSE')} ${c.dim('end of stored events for')} ${c.white(String(rest[0]))}`,
        )
        break
      case 'OK': {
        const [id, accepted, message] = rest
        const badge = accepted ? c.green(c.bold('OK')) : c.brightRed(c.bold('REJECTED'))
        const tail = message ? ` ${c.dim(String(message))}` : ''
        this.write(`${this.gutter(IN, accepted ? c.green : c.brightRed)} ${badge} ${c.dim(shortHex(id))}${tail}`)
        break
      }
      case 'NOTICE':
        this.write(`${this.gutter(IN, c.yellow)} ${c.yellow('NOTICE')} ${String(rest[0])}`)
        break
      case 'CLOSED': {
        const [subId, message] = rest
        this.write(
          `${this.gutter(IN, c.brightRed)} ${c.brightRed('CLOSED')} ${c.white(String(subId))} ${c.dim(String(message ?? ''))}`,
        )
        break
      }
      case 'COUNT': {
        const [subId, payload] = rest
        this.write(
          `${this.gutter(IN, c.cyan)} ${c.cyan('COUNT')} ${c.white(String(subId))} ${c.bold(String(payload?.count ?? '?'))}`,
        )
        break
      }
      default:
        this.write(`${this.gutter(IN)} ${c.bold(type)} ${c.dim(oneLine(JSON.stringify(rest), this.contentWidth))}`)
    }
  }

  #renderEvent(subId, event) {
    if (!event || typeof event !== 'object') {
      this.write(`${this.gutter(IN)} ${c.bold('EVENT')} ${c.dim('(malformed)')}`)
      return
    }

    const kindLabel = describeKind(event.kind)
    const head = [
      this.gutter(IN, c.green),
      c.green(c.bold('EVENT')),
      c.dim(`[${subId}]`),
      c.brightCyan(kindLabel),
      c.magenta(shortNpub(event.pubkey)),
      c.gray(formatUnix(event.created_at)),
    ].join(' ')
    this.write(head)

    const marks = eventMarkers(event)
    if (marks.length) {
      this.write(`${' '.repeat(15)}${c.gray(marks.join('  '))}`)
    }

    if (event.content) {
      const body = this.verbose
        ? String(event.content)
        : oneLine(event.content, this.contentWidth)
      for (const line of body.split('\n')) {
        this.write(`${' '.repeat(15)}${c.white(line)}`)
      }
    }

    if (this.showTags && Array.isArray(event.tags) && event.tags.length) {
      for (const tag of event.tags) {
        this.write(`${' '.repeat(15)}${c.dim(`tag ${JSON.stringify(tag)}`)}`)
      }
    }

    if (this.verbose) {
      this.write(`${' '.repeat(15)}${c.dim(`id ${event.id}  ${kindClass(event.kind)}`)}`)
    }
  }

  #summariseOutbound(parsed, raw) {
    const [type, ...rest] = parsed
    switch (type) {
      case 'REQ':
        return `${c.brightBlue(c.bold('REQ'))} ${c.white(String(rest[0]))} ${c.dim(oneLine(JSON.stringify(rest.slice(1)), this.contentWidth))}`
      case 'CLOSE':
        return `${c.brightBlue(c.bold('CLOSE'))} ${c.white(String(rest[0]))}`
      case 'AUTH':
        return `${c.brightBlue(c.bold('AUTH'))} ${c.dim('signed event')} ${c.dim(shortHex(rest[0]?.id))}`
      case 'EVENT':
        return `${c.brightBlue(c.bold('EVENT'))} ${c.dim(describeKind(rest[0]?.kind))} ${c.dim(shortHex(rest[0]?.id))}`
      default:
        return c.dim(oneLine(raw, this.contentWidth))
    }
  }
}

/** Pull the interesting tags out of an event for a compact second line. */
export function eventMarkers(event) {
  const tags = Array.isArray(event.tags) ? event.tags : []
  const marks = []
  const group = tags.find((t) => t[0] === 'h')?.[1]
  if (group) marks.push(`h:${group}`)
  const identifier = tags.find((t) => t[0] === 'd')?.[1]
  if (identifier) marks.push(`d:${identifier}`)
  const replyCount = tags.filter((t) => t[0] === 'e').length
  if (replyCount) marks.push(`e×${replyCount}`)
  const mentionCount = tags.filter((t) => t[0] === 'p').length
  if (mentionCount) marks.push(`p×${mentionCount}`)
  const subject = tags.find((t) => t[0] === 'subject')?.[1]
  if (subject) marks.push(`subject:${oneLine(subject, 48)}`)
  return marks
}

/** Multi-line banner describing the relay, from its NIP-11 document. */
export function relayBanner(url, info) {
  const lines = []
  const title = info?.name ? `${info.name}` : 'unknown relay'
  lines.push(`${c.bold(c.brightCyan('wsscope'))} ${c.dim('→')} ${c.bold(url)}`)
  lines.push(`  ${c.dim('relay')}    ${c.white(title)}`)
  if (!info) {
    lines.push(`  ${c.dim('nip-11')}   ${c.dim('no information document served')}`)
    return lines
  }
  if (info.description) lines.push(`  ${c.dim('about')}    ${c.white(oneLine(info.description, 100))}`)
  if (info.software) {
    const version = info.version ? ` ${info.version}` : ''
    lines.push(`  ${c.dim('software')} ${c.white(`${info.software}${version}`)}`)
  }
  if (Array.isArray(info.supported_nips)) {
    lines.push(`  ${c.dim('nips')}     ${c.white(info.supported_nips.join(', '))}`)
  }
  const limitation = info.limitation ?? {}
  const flags = []
  if (limitation.auth_required) flags.push(c.yellow('auth required'))
  if (limitation.payment_required) flags.push(c.yellow('payment required'))
  if (limitation.restricted_writes) flags.push(c.yellow('restricted writes'))
  if (limitation.min_pow_difficulty) flags.push(c.yellow(`pow ${limitation.min_pow_difficulty}`))
  if (flags.length) lines.push(`  ${c.dim('policy')}   ${flags.join(c.dim(' · '))}`)
  return lines
}

/** Session summary printed on exit. */
export function statsReport(stats, { url } = {}) {
  const lines = []
  lines.push(c.dim('─'.repeat(Math.min(60, process.stdout.columns || 60))))
  lines.push(`${c.bold('session')} ${c.dim(url ?? '')}`)
  lines.push(
    `  ${c.dim('frames')}   ${c.white(`${stats.framesIn} in`)} ${c.dim('/')} ${c.white(`${stats.framesOut} out`)}`,
  )
  lines.push(
    `  ${c.dim('traffic')}  ${c.white(humanBytes(stats.bytesIn))} ${c.dim('in /')} ${c.white(humanBytes(stats.bytesOut))} ${c.dim('out')}`,
  )
  if (stats.byType.size) {
    const parts = [...stats.byType.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${type}×${n}`)
    lines.push(`  ${c.dim('types')}    ${c.white(parts.join('  '))}`)
  }
  if (stats.byKind.size) {
    const parts = [...stats.byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([kind, n]) => `${describeKind(kind)}×${n}`)
    lines.push(`  ${c.dim('kinds')}    ${c.white(parts.join('  '))}`)
  }
  return lines
}

export { displayWidth }
