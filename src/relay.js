import { EventEmitter } from 'node:events'

/**
 * A resilient WebSocket connection to a Nostr relay.
 *
 * Emits:
 *   open       ()                     socket established
 *   frame      (raw, parsed|null)     every inbound frame, raw text + parsed JSON
 *   sent       (raw)                  every outbound frame
 *   close      ({code, reason})       socket closed
 *   error      (err)                  transport error
 *   reconnect  ({attempt, delayMs})   scheduled retry
 *   giveup     ({attempts})           retry budget exhausted
 */
export class RelayConnection extends EventEmitter {
  constructor(url, { reconnect = true, maxRetries = Infinity, maxDelayMs = 30_000 } = {}) {
    super()
    this.url = url
    this.reconnectEnabled = reconnect
    this.maxRetries = maxRetries
    this.maxDelayMs = maxDelayMs

    this.ws = null
    this.attempt = 0
    this.closedByUser = false
    this.retryTimer = null

    this.stats = {
      connectedAt: null,
      connections: 0,
      framesIn: 0,
      framesOut: 0,
      bytesIn: 0,
      bytesOut: 0,
      byType: new Map(),
      byKind: new Map(),
    }
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect() {
    this.closedByUser = false
    let ws
    try {
      ws = new WebSocket(this.url)
    } catch (err) {
      // Malformed URL and similar synchronous failures.
      this.emit('error', err)
      this.#scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.attempt = 0
      this.stats.connections += 1
      this.stats.connectedAt = Date.now()
      this.emit('open')
    }

    ws.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : bufferToText(event.data)
      this.stats.framesIn += 1
      this.stats.bytesIn += Buffer.byteLength(raw)

      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }

      if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
        bump(this.stats.byType, parsed[0])
        if (parsed[0] === 'EVENT' && parsed[2]?.kind !== undefined) {
          bump(this.stats.byKind, parsed[2].kind)
        }
      }

      this.emit('frame', raw, parsed)
    }

    ws.onerror = (event) => {
      this.emit('error', event?.error ?? new Error(event?.message ?? 'websocket error'))
    }

    ws.onclose = (event) => {
      this.ws = null
      this.stats.connectedAt = null
      this.emit('close', { code: event?.code ?? 1006, reason: event?.reason ?? '' })
      if (!this.closedByUser) this.#scheduleReconnect()
    }
  }

  /** Send a protocol message. Accepts an array/object (JSON-encoded) or a raw string. */
  send(message) {
    if (!this.connected) return false
    const raw = typeof message === 'string' ? message : JSON.stringify(message)
    this.ws.send(raw)
    this.stats.framesOut += 1
    this.stats.bytesOut += Buffer.byteLength(raw)
    this.emit('sent', raw)
    return true
  }

  close(code = 1000, reason = '') {
    this.closedByUser = true
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    try {
      this.ws?.close(code, reason)
    } catch {
      // Socket was already gone; nothing to do.
    }
    this.ws = null
  }

  #scheduleReconnect() {
    if (!this.reconnectEnabled || this.closedByUser) return
    if (this.attempt >= this.maxRetries) {
      this.emit('giveup', { attempts: this.attempt })
      return
    }
    this.attempt += 1
    const delayMs = backoffDelay(this.attempt, this.maxDelayMs)
    this.emit('reconnect', { attempt: this.attempt, delayMs })
    this.retryTimer = setTimeout(() => this.connect(), delayMs)
    this.retryTimer.unref?.()
  }
}

/**
 * Exponential backoff with ±12.5% jitter: ~1s, 2s, 4s … capped at maxDelayMs.
 * The cap is applied after jitter so the delay never exceeds it.
 */
export function backoffDelay(attempt, maxDelayMs = 30_000) {
  const base = Math.min(maxDelayMs, 1000 * 2 ** (attempt - 1))
  const jitter = base * 0.25 * Math.random()
  return Math.round(Math.min(maxDelayMs, base * 0.875 + jitter))
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function bufferToText(data) {
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  return String(data)
}
