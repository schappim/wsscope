/**
 * Minimal ANSI styling. No dependency, honours NO_COLOR and non-TTY output.
 */

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
}

let enabled = true

export function setColorEnabled(value) {
  enabled = Boolean(value)
}

export function colorEnabled() {
  return enabled
}

/**
 * Decide whether colour should be on, given CLI flags and the environment.
 * Explicit flags win; otherwise we colour only when stdout is a terminal.
 */
export function detectColor({ forceColor = false, noColor = false } = {}) {
  if (noColor) return false
  if (forceColor) return true
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true
  return Boolean(process.stdout.isTTY)
}

function wrap(code) {
  return (text) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text))
}

export const c = Object.fromEntries(
  Object.entries(CODES).map(([name, code]) => [name, wrap(code)]),
)

/** Strip ANSI escapes so we can measure real display width. */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\u001b\[[0-9;]*m/g, '')
}

export function displayWidth(text) {
  return stripAnsi(text).length
}
