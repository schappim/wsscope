import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { c, detectColor, setColorEnabled } from './colors.js'
import { DEFAULT_LIMIT, DEFAULT_RELAY } from './defaults.js'
import { RelayConnection } from './relay.js'
import { Renderer, relayBanner, statsReport, humanDuration } from './render.js'
import { buildFilters, subscriptionIdFactory } from './filters.js'
import { fetchRelayInfo } from './nip11.js'
import { resolveSecretKey, shortNpub } from './keys.js'
import { authMessage, buildAuthEvent } from './auth.js'
import { helpLines, startRepl } from './repl.js'
import { usage } from './help.js'

const OPTIONS = {
  sec: { type: 'string', short: 's' },
  filter: { type: 'string', short: 'f', multiple: true },
  kinds: { type: 'string', short: 'k' },
  author: { type: 'string', short: 'a', multiple: true },
  mention: { type: 'string', short: 'p', multiple: true },
  group: { type: 'string', short: 'g', multiple: true },
  id: { type: 'string', multiple: true },
  tag: { type: 'string', multiple: true },
  search: { type: 'string' },
  limit: { type: 'string', short: 'l' },
  since: { type: 'string' },
  until: { type: 'string' },
  count: { type: 'string', short: 'n' },
  timeout: { type: 'string', short: 'T' },
  width: { type: 'string', short: 'w' },
  retries: { type: 'string' },
  verbose: { type: 'boolean', short: 'v' },
  tags: { type: 'boolean', short: 't' },
  raw: { type: 'boolean', short: 'r' },
  json: { type: 'boolean', short: 'j' },
  quiet: { type: 'boolean', short: 'q' },
  info: { type: 'boolean', short: 'i' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'V' },
  color: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  'no-auth': { type: 'boolean' },
  'no-reconnect': { type: 'boolean' },
  'no-subscribe': { type: 'boolean' },
  'no-stats': { type: 'boolean' },
}

export async function main(argv) {
  let values
  let positionals
  try {
    ;({ values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }))
  } catch (err) {
    setColorEnabled(detectColor({}))
    process.stderr.write(`${c.brightRed('error')} ${err.message}\n\nRun ${c.bold('wsscope --help')} for usage.\n`)
    return 2
  }

  const useColor = values.json ? false : detectColor({ forceColor: values.color, noColor: values['no-color'] })
  setColorEnabled(useColor)

  if (values.help) {
    process.stdout.write(usage())
    return 0
  }
  if (values.version) {
    process.stdout.write(`${packageVersion()}\n`)
    return 0
  }

  const url = normaliseUrl(positionals[0] ?? DEFAULT_RELAY)

  let identity = null
  try {
    identity = resolveSecretKey(values.sec)
  } catch (err) {
    process.stderr.write(`${c.brightRed('error')} ${err.message}\n`)
    return 2
  }

  let filters
  try {
    filters = buildFilters(values)
  } catch (err) {
    process.stderr.write(`${c.brightRed('error')} ${err.message}\n`)
    return 2
  }
  if (filters.length === 0) filters = [{ limit: DEFAULT_LIMIT }]

  const info = await fetchRelayInfo(url)

  if (values.info) {
    if (!info) {
      process.stderr.write(`${c.brightRed('error')} ${url} did not serve a NIP-11 document\n`)
      return 1
    }
    process.stdout.write(`${JSON.stringify(info, null, 2)}\n`)
    return 0
  }

  return run({ url, info, identity, filters, values })
}

function run({ url, info, identity, filters, values }) {
  const renderer = new Renderer({
    verbose: Boolean(values.verbose),
    showTags: Boolean(values.tags),
    contentWidth: Number(values.width) > 0 ? Number(values.width) : 140,
  })

  const json = Boolean(values.json)
  let showRaw = Boolean(values.raw)
  const authEnabled = Boolean(identity) && !values['no-auth']
  const subscribeEnabled = !values['no-subscribe']
  const maxEvents = values.count ? Number(values.count) : Infinity
  const startedAt = Date.now()

  const nextSubId = subscriptionIdFactory()
  const connection = new RelayConnection(url, {
    reconnect: !values['no-reconnect'],
    maxRetries: values.retries ? Number(values.retries) : Infinity,
  })

  // Per-connection state, reset on every (re)connect.
  let session = freshSession()
  let eventCount = 0
  let exiting = false
  let exitCode = 0
  let repl = null
  let resolveDone

  const done = new Promise((resolve) => {
    resolveDone = resolve
  })

  function freshSession() {
    return { challenge: null, authEventId: null, authState: 'none', subscribed: false, subscribeTimer: null }
  }

  function emitJson(record) {
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`)
  }

  function status(text, level) {
    if (json) return
    renderer.status(text, { level })
  }

  function subscribe(reason) {
    if (!subscribeEnabled || session.subscribed) return
    clearTimeout(session.subscribeTimer)
    session.subscribeTimer = null
    session.subscribed = true
    const subId = nextSubId()
    if (reason && !json) status(`subscribing (${reason})`, 'info')
    connection.send(['REQ', subId, ...filters])
  }

  function sendAuth() {
    if (!identity || !session.challenge) return false
    const event = buildAuthEvent({ relayUrl: url, challenge: session.challenge, secret: identity.secret })
    session.authEventId = event.id
    session.authState = 'pending'
    connection.send(authMessage(event))
    return true
  }

  function finish(code = 0) {
    if (exiting) return
    exiting = true
    exitCode = code
    clearTimeout(session.subscribeTimer)
    connection.close(1000, 'client exit')
    repl?.close()

    if (!json && !values['no-stats']) {
      const lines = statsReport(connection.stats, { url })
      lines.push(`  ${c.dim('elapsed')}  ${c.white(humanDuration(Date.now() - startedAt))}`)
      renderer.banner(lines)
    }
    resolveDone(exitCode)
  }

  if (!values.quiet && !json) {
    renderer.banner(relayBanner(url, info))
    if (identity) {
      renderer.banner([`  ${c.dim('identity')} ${c.magenta(shortNpub(identity.pubkey))}`])
    } else if (info?.limitation?.auth_required) {
      renderer.banner([
        `  ${c.dim('hint')}     ${c.yellow('this relay requires NIP-42 auth — pass --sec <nsec> to read events')}`,
      ])
    }
    if (process.stdin.isTTY) {
      renderer.banner([`  ${c.dim('type')}     ${c.dim('/help for commands, /quit to exit')}`])
    }
    renderer.banner([''])
  }

  connection.on('open', () => {
    session = freshSession()
    status(`connected${connection.stats.connections > 1 ? ` (attempt ${connection.stats.connections})` : ''}`, 'good')

    if (authEnabled && info?.limitation?.auth_required) {
      // Give the relay a moment to send its AUTH challenge before we subscribe
      // blind — but never hang forever if it doesn't.
      session.subscribeTimer = setTimeout(() => subscribe('no auth challenge received'), 2500)
      session.subscribeTimer.unref?.()
    } else {
      subscribe()
    }
  })

  connection.on('frame', (raw, parsed) => {
    if (json) {
      const type = Array.isArray(parsed) ? parsed[0] : null
      emitJson({
        dir: 'in',
        type,
        sub: type === 'EVENT' || type === 'EOSE' || type === 'CLOSED' ? parsed[1] : undefined,
        payload: Array.isArray(parsed) ? (type === 'EVENT' ? parsed[2] : parsed.slice(1)) : raw,
      })
    } else if (showRaw) {
      renderer.raw(raw, 'in')
    } else {
      renderer.inbound(raw, parsed)
    }

    if (!Array.isArray(parsed)) return
    const [type] = parsed

    if (type === 'AUTH' && typeof parsed[1] === 'string') {
      session.challenge = parsed[1]
      if (authEnabled) {
        status('answering AUTH challenge…', 'info')
        sendAuth()
      } else if (!identity) {
        status('relay sent an AUTH challenge — pass --sec <nsec> to authenticate', 'warn')
        subscribe()
      }
      return
    }

    if (type === 'OK' && parsed[1] === session.authEventId) {
      const accepted = parsed[2] === true
      session.authState = accepted ? 'ok' : 'failed'
      if (accepted) {
        status(`authenticated as ${shortNpub(identity.pubkey)}`, 'good')
        subscribe()
      } else {
        status(`authentication rejected: ${parsed[3] ?? 'no reason given'}`, 'error')
        subscribe('auth failed, trying anyway')
      }
      return
    }

    if (type === 'EVENT') {
      eventCount += 1
      if (eventCount >= maxEvents) finish(0)
    }
  })

  connection.on('sent', (raw) => {
    if (json) {
      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
      emitJson({ dir: 'out', type: Array.isArray(parsed) ? parsed[0] : null, payload: parsed ?? raw })
    } else if (showRaw) {
      renderer.raw(raw, 'out')
    } else {
      renderer.outbound(raw)
    }
  })

  connection.on('error', (err) => {
    status(`connection error: ${err?.message ?? err}`, 'error')
  })

  connection.on('close', ({ code, reason }) => {
    if (exiting) return
    const detail = reason ? ` ${reason}` : ''
    status(`disconnected (${code})${detail}`, 'warn')
    if (values['no-reconnect']) finish(code === 1000 ? 0 : 1)
  })

  connection.on('reconnect', ({ attempt, delayMs }) => {
    status(`reconnecting in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt})`, 'warn')
  })

  connection.on('giveup', ({ attempts }) => {
    status(`giving up after ${attempts} attempts`, 'error')
    finish(1)
  })

  if (values.timeout) {
    const timer = setTimeout(() => finish(0), Number(values.timeout) * 1000)
    timer.unref?.()
  }

  if (!json) {
    repl = startRepl({
      onRawSend: (raw) => {
        if (!connection.send(raw)) status('not connected — message not sent', 'error')
      },
      onCommand: (name, rest) => handleCommand(name, rest),
    })
  }

  process.on('SIGINT', () => finish(0))
  process.on('SIGTERM', () => finish(0))

  connection.connect()
  return done

  function handleCommand(name, rest) {
    switch (name) {
      case 'quit':
      case 'exit':
      case 'q':
        finish(0)
        break
      case 'help':
      case '?':
        renderer.banner(helpLines())
        break
      case 'req': {
        let parsed
        try {
          parsed = JSON.parse(rest || '{}')
        } catch (err) {
          status(`invalid filter JSON: ${err.message}`, 'error')
          break
        }
        const list = Array.isArray(parsed) ? parsed : [parsed]
        connection.send(['REQ', nextSubId(), ...list])
        break
      }
      case 'close':
        if (!rest) status('usage: /close <sub-id>', 'error')
        else connection.send(['CLOSE', rest])
        break
      case 'auth':
        if (!identity) status('no secret key — restart with --sec <nsec>', 'error')
        else if (!session.challenge) status('no AUTH challenge received yet', 'error')
        else sendAuth()
        break
      case 'info':
        renderer.banner(relayBanner(url, info))
        break
      case 'stats':
        renderer.banner(statsReport(connection.stats, { url }))
        break
      case 'raw':
        showRaw = !showRaw
        status(`raw mode ${showRaw ? 'on' : 'off'}`, 'info')
        break
      case 'verbose':
        renderer.verbose = !renderer.verbose
        status(`verbose ${renderer.verbose ? 'on' : 'off'}`, 'info')
        break
      case 'tags':
        renderer.showTags = !renderer.showTags
        status(`tags ${renderer.showTags ? 'on' : 'off'}`, 'info')
        break
      case 'clear':
        process.stdout.write('\u001b[2J\u001b[H')
        break
      default:
        status(`unknown command — try /help`, 'error')
    }
  }
}

/** Accept `example.com`, `wss://example.com`, `https://example.com`. */
export function normaliseUrl(input) {
  const value = String(input).trim()
  if (/^wss?:\/\//i.test(value)) return value
  if (/^https:\/\//i.test(value)) return `wss://${value.slice('https://'.length)}`
  if (/^http:\/\//i.test(value)) return `ws://${value.slice('http://'.length)}`
  return `wss://${value}`
}

function packageVersion() {
  try {
    const path = fileURLToPath(new URL('../package.json', import.meta.url))
    return JSON.parse(readFileSync(path, 'utf8')).version
  } catch {
    return '0.0.0'
  }
}
