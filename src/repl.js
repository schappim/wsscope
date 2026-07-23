import readline from 'node:readline'
import { c } from './colors.js'

const HELP = [
  ['/req <filter json>', 'open a subscription, e.g. /req {"kinds":[1],"limit":10}'],
  ['/close <sub-id>', 'close a subscription'],
  ['/auth', 're-send a NIP-42 auth response using the last challenge'],
  ['/info', 'reprint the relay information document'],
  ['/stats', 'show counters for this session'],
  ['/raw', 'toggle raw frame output'],
  ['/verbose', 'toggle full event bodies'],
  ['/tags', 'toggle tag output'],
  ['/clear', 'clear the screen'],
  ['/help', 'show this list'],
  ['/quit', 'disconnect and exit'],
]

/**
 * Line-oriented command input. Anything that isn't a /command and parses as a
 * JSON array is sent to the relay verbatim, so the CLI never blocks you from
 * poking at the protocol directly.
 */
export function startRepl({ onCommand, onRawSend, prompt = '' }) {
  if (!process.stdin.isTTY) return null

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt,
    terminal: true,
  })

  rl.on('line', (line) => {
    const input = line.trim()
    if (!input) return rl.prompt()

    if (input.startsWith('/')) {
      const space = input.indexOf(' ')
      const name = (space === -1 ? input : input.slice(0, space)).slice(1).toLowerCase()
      const rest = space === -1 ? '' : input.slice(space + 1).trim()
      onCommand(name, rest)
    } else if (input.startsWith('[')) {
      onRawSend(input)
    } else {
      onCommand('unknown', input)
    }
    rl.prompt()
  })

  rl.on('SIGINT', () => {
    onCommand('quit', '')
  })

  return rl
}

export function helpLines() {
  const width = Math.max(...HELP.map(([cmd]) => cmd.length))
  return [
    c.bold('commands'),
    ...HELP.map(([cmd, description]) => `  ${c.brightCyan(cmd.padEnd(width))}  ${c.dim(description)}`),
    `  ${c.brightCyan('[…]'.padEnd(width))}  ${c.dim('a raw JSON array is sent to the relay as-is')}`,
  ]
}
