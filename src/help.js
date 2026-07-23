import { c } from './colors.js'
import { DEFAULT_RELAY } from './defaults.js'

export function usage() {
  return `
${c.bold(c.brightCyan('wsscope'))} — watch a Nostr relay's WebSocket stream in your terminal

${c.bold('USAGE')}
  wsscope [url] [options]

  Default url: ${c.white(DEFAULT_RELAY)}

${c.bold('CONNECTION')}
  -s, --sec <key>        Secret key (nsec1… or hex) used to answer NIP-42 AUTH.
                         Falls back to $WSSCOPE_SEC, then $NOSTR_SEC.
      --no-auth          Never respond to an AUTH challenge.
      --no-reconnect     Exit on disconnect instead of retrying.
      --retries <n>      Maximum reconnect attempts (default: unlimited).

${c.bold('WHAT TO SUBSCRIBE TO')}
  -f, --filter <json>    Raw NIP-01 filter. Repeatable; all are sent in one REQ.
  -k, --kinds <list>     Comma-separated event kinds, e.g. 1,7,9
  -a, --author <key>     npub or hex author. Repeatable.
  -p, --mention <key>    npub or hex in a #p tag. Repeatable.
  -g, --group <id>       NIP-29 group id (#h tag). Repeatable.
      --id <list>        Specific event ids.
      --tag <name=val>   Any tag filter, e.g. --tag t=intro. Repeatable.
      --search <text>    NIP-50 full-text search.
  -l, --limit <n>        Stored events to replay (default: 25).
      --since <when>     30m, 2h, 7d or a unix timestamp.
      --until <when>     Same formats as --since.
      --no-subscribe     Connect and watch only; never send a REQ.

${c.bold('OUTPUT')}
  -v, --verbose          Full event bodies and ids instead of one-line previews.
  -t, --tags             Print every tag on each event.
  -r, --raw              Print raw frames exactly as received.
  -j, --json             NDJSON to stdout, one object per frame. Implies --no-color.
  -q, --quiet            Skip the startup banner.
  -w, --width <n>        Content preview width (default: 140).
      --no-color         Disable ANSI colour.
      --color            Force ANSI colour even when piped.

${c.bold('LIFECYCLE')}
  -n, --count <n>        Exit after n EVENT frames.
  -T, --timeout <sec>    Exit after n seconds.
  -i, --info             Print the NIP-11 relay document and exit.
      --no-stats         Skip the summary printed on exit.
  -h, --help             Show this help.
  -V, --version          Show the version.

${c.bold('EXAMPLES')}
  ${c.dim('# Watch the default relay; unauthenticated sessions still show the handshake')}
  wsscope

  ${c.dim('# Inspect what the relay says about itself')}
  wsscope --info

  ${c.dim('# Authenticate, then follow a NIP-29 group live')}
  wsscope --sec nsec1… --group 8f14e45f-ceea-467a-9575-28bc1b2d1f2b

  ${c.dim('# Last 50 notes and reactions, full bodies')}
  wsscope --kinds 1,7 --limit 50 --verbose

  ${c.dim('# Pipe structured frames into jq')}
  wsscope --json --count 20 | jq 'select(.type == "EVENT") | .payload.content'
`.trimStart()
}
