# wsscope

A terminal viewer for [Nostr](https://nostr.com) relay WebSocket streams. Point it at a `wss://` URL and it shows you what's actually happening on the wire — the handshake, the protocol frames, and a readable render of every event — instead of a wall of raw JSON.

It defaults to `wss://vcmc.communities.buzz.xyz`, but works against any Nostr relay.

```console
$ wsscope wss://relay.damus.io --kinds 1,7 --limit 6
wsscope → wss://relay.damus.io
  relay    damus.io
  about    Damus strfry relay
  software git+https://github.com/hoytech/strfry.git 1.1.0-1-g691a533f11eb
  nips     1, 2, 4, 9, 11, 28, 40, 45, 70, 77

09:05:36.770 • connected
09:05:36.771 → REQ sub1 [{"kinds":[1,7],"limit":6}]
09:05:37.193 ← EVENT [sub1] 7 Reaction npub17mku6l3…x57f08 2026-07-24 09:05:31
               e×1  p×1
               🐧
09:05:37.194 ← EVENT [sub1] 1 Short Text Note npub1yjvddyg…htq4cv 2026-07-24 09:05:30
09:05:37.195 ← EVENT [sub1] 1 Short Text Note npub15r97fj5…9pu78t 2026-07-24 09:05:29
               e×1  p×1
               Decentralized platforms like Fountain embody self-ownership, freeing individuals from centraliz…
09:05:37.202 ← EVENT [sub1] 7 Reaction npub1rews7yd…ta55yf 2026-07-24 09:05:26
               e×1  p×1
               ❤️
────────────────────────────────────────────────────────────
session wss://relay.damus.io
  frames   6 in / 1 out
  traffic  43.1 KB in / 40 B out
  types    EVENT×6
  kinds    1 Short Text Note×4  7 Reaction×2
  elapsed  0s
```

Against an authenticating relay you see the whole NIP-42 handshake, including exactly why you were turned away:

```console
$ wsscope --sec nsec1…
wsscope → wss://vcmc.communities.buzz.xyz
  relay    Buzz Relay
  about    Buzz — private team communication relay
  software https://github.com/block/buzz 0.2.0
  nips     1, 2, 10, 11, 16, 17, 23, 25, 29, 33, 38, 42, 50, 56, 43
  policy   auth required · restricted writes
  identity npub1fr7ca6a…jenc3u

09:03:40.818 • connected
09:03:40.818 ← AUTH challenge 2d9169b6ccab37c218e948ef6a6bef9ada893dd13ee96698b12662a644d681b4
09:03:40.818 • answering AUTH challenge…
09:03:40.824 → AUTH signed event fd2ffe90…6a1c082b
09:03:41.048 ← REJECTED fd2ffe90…6a1c082b restricted: not a relay member
09:03:41.048 • authentication rejected: restricted: not a relay member
```

## Why

Nostr relays speak a simple JSON-over-WebSocket protocol, but debugging one with `websocat` means squinting at unformatted arrays. `wsscope` decodes the protocol: it names event kinds, shortens pubkeys to `npub`s, formats timestamps, surfaces the tags that matter, and — crucially — handles [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) authentication, so you can actually read a private relay rather than watching it hang up on you.

## Requirements

Node.js 22 or newer. `wsscope` uses Node's built-in `WebSocket`, so there's no `ws` dependency; the only runtime dependency is [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) for key handling and event signing.

## Install

```bash
git clone https://github.com/schappim/wsscope.git
cd wsscope
npm install
npm link          # puts `wsscope` on your PATH
```

Or run it without installing:

```bash
npx github:schappim/wsscope
```

Or just from the checkout:

```bash
node bin/wsscope.js
```

## Usage

```
wsscope [url] [options]
```

### Watch a relay

```bash
# The default relay
wsscope

# Any other relay — bare hostnames get wss:// prepended
wsscope wss://relay.damus.io
wsscope relay.damus.io
```

### See what the relay says about itself

`--info` prints the relay's [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md) information document and exits. It's plain JSON, so pipe it to `jq`:

```bash
wsscope --info | jq '.limitation'
```

### Authenticate

Relays with `auth_required` send an `["AUTH", <challenge>]` frame and refuse to serve events until you answer it. Give `wsscope` a secret key and it signs the kind `22242` response for you, waits for the relay's `OK`, and only then subscribes:

```bash
wsscope --sec nsec1yourkeyhere...
```

The key can be `nsec1…` bech32 or 64 hex characters. To keep it out of your shell history, use an environment variable instead — `WSSCOPE_SEC` is checked first, then `NOSTR_SEC`:

```bash
export WSSCOPE_SEC=nsec1yourkeyhere...
wsscope
```

Your secret key never leaves the process: it's used locally to sign the auth event, and only the signature is sent.

### Choose what to subscribe to

Without any filter flags, `wsscope` subscribes to `{"limit": 25}` — the last 25 events, then everything new as it arrives. The shorthand flags all merge into a single filter:

```bash
# Notes and reactions
wsscope --kinds 1,7

# A specific author
wsscope --author npub1sn0wdenkukak0d94a5yjmwan9q0vn0…

# A NIP-29 group, by its #h tag
wsscope --group 8f14e45f-ceea-467a-9575-28bc1b2d1f2b

# Anything tagged #t=introductions in the last two hours
wsscope --tag t=introductions --since 2h

# NIP-50 full-text search
wsscope --search "release notes"
```

`--since` and `--until` take `30s`, `15m`, `2h`, `7d`, `1w`, or a raw unix timestamp.

For anything the shorthand doesn't cover, pass a raw NIP-01 filter. `--filter` is repeatable and every filter is sent in one `REQ`:

```bash
wsscope --filter '{"kinds":[30023],"limit":5}' --filter '{"kinds":[1],"#t":["nostr"]}'
```

Use `--no-subscribe` to connect and watch without sending a `REQ` at all — useful when you only care about the handshake.

### Read the output

Each line starts with a local timestamp and a direction marker:

| Marker | Meaning |
| ------ | ------------------------------- |
| `←`    | frame received from the relay   |
| `→`    | frame sent to the relay         |
| `•`    | local status, not wire traffic  |

Events print a header (kind, author, creation time), then a second line of notable tags (`h:` group, `d:` identifier, `e×n` references, `p×n` mentions, `subject:`), then the content.

```bash
wsscope --verbose     # full content bodies and event ids, not one-line previews
wsscope --tags        # every tag on every event
wsscope --raw         # exact frames, no decoding
wsscope --width 200   # widen the content preview
```

### Script it

`--json` emits newline-delimited JSON — one object per frame, no colour, no banner:

```bash
wsscope --json --count 20 | jq -r 'select(.type == "EVENT") | .payload.content'
```

Each record looks like:

```json
{"ts":"2026-07-24T09:03:41.402Z","dir":"in","type":"EVENT","sub":"sub1","payload":{"id":"…","kind":9,"content":"…"}}
```

Combine with `--count <n>` (exit after n events) or `--timeout <seconds>` (exit after n seconds) so the command terminates on its own.

### Interactive commands

When stdout is a terminal you can type at the stream:

| Command             | Effect                                        |
| ------------------- | --------------------------------------------- |
| `/req <filter json>`| open another subscription                     |
| `/close <sub-id>`   | close a subscription                          |
| `/auth`             | re-send the NIP-42 response                   |
| `/info`             | reprint the relay banner                      |
| `/stats`            | frame and byte counters for this session       |
| `/raw`              | toggle raw frame output                       |
| `/verbose`          | toggle full event bodies                      |
| `/tags`             | toggle tag output                             |
| `/clear`            | clear the screen                              |
| `/help`             | list commands                                 |
| `/quit`             | disconnect and exit                           |

Anything starting with `[` is sent to the relay verbatim, so you're never boxed in by the flags:

```
["COUNT","c1",{"kinds":[1]}]
```

### Reconnection

Dropped connections are retried with exponential backoff and jitter (~1s, 2s, 4s … capped at 30s), re-authenticating and re-subscribing each time. `--no-reconnect` exits on the first disconnect instead; `--retries <n>` caps the attempts.

## Options

| Flag | Description |
| --- | --- |
| `-s, --sec <key>` | Secret key (`nsec1…` or hex) for NIP-42 auth. Falls back to `$WSSCOPE_SEC`, then `$NOSTR_SEC`. |
| `--no-auth` | Never respond to an AUTH challenge. |
| `--no-reconnect` | Exit on disconnect instead of retrying. |
| `--retries <n>` | Maximum reconnect attempts. |
| `-f, --filter <json>` | Raw NIP-01 filter. Repeatable. |
| `-k, --kinds <list>` | Comma-separated event kinds. |
| `-a, --author <key>` | npub or hex author. Repeatable. |
| `-p, --mention <key>` | npub or hex in a `#p` tag. Repeatable. |
| `-g, --group <id>` | NIP-29 group id (`#h` tag). Repeatable. |
| `--id <list>` | Specific event ids. |
| `--tag <name=val>` | Any tag filter, e.g. `--tag t=intro`. Repeatable. |
| `--search <text>` | NIP-50 full-text search. |
| `-l, --limit <n>` | Stored events to replay. Default 25. |
| `--since <when>` | `30m`, `2h`, `7d`, or a unix timestamp. |
| `--until <when>` | Same formats as `--since`. |
| `--no-subscribe` | Connect and watch only; never send a `REQ`. |
| `-v, --verbose` | Full event bodies and ids. |
| `-t, --tags` | Print every tag on each event. |
| `-r, --raw` | Print raw frames as received. |
| `-j, --json` | NDJSON to stdout. Implies `--no-color`. |
| `-q, --quiet` | Skip the startup banner. |
| `-w, --width <n>` | Content preview width. Default 140. |
| `--color` / `--no-color` | Force or disable ANSI colour. `NO_COLOR` is honoured. |
| `-n, --count <n>` | Exit after n `EVENT` frames. |
| `-T, --timeout <sec>` | Exit after n seconds. |
| `-i, --info` | Print the NIP-11 document and exit. |
| `--no-stats` | Skip the summary printed on exit. |
| `-h, --help` | Show help. |
| `-V, --version` | Show the version. |

Exit codes: `0` success, `1` runtime failure (gave up reconnecting, no NIP-11 document), `2` bad arguments.

## A note on the default relay

`wss://vcmc.communities.buzz.xyz` is a [Buzz](https://github.com/block/buzz) relay — a private team communication relay. It requires NIP-42 auth *and* membership: an unknown key that authenticates correctly is still rejected with `restricted: not a relay member`. Without credentials you'll see the handshake and the refusal, which is itself a useful thing to be able to look at. Point `wsscope` at a public relay like `wss://relay.damus.io` to watch a live event stream.

## Supported NIPs

- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) — base protocol, filters, subscriptions
- [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md) — relay information document
- [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) — `npub`/`nsec` encoding
- [NIP-29](https://github.com/nostr-protocol/nips/blob/master/29.md) — relay-based groups (`#h` filtering, group kind names)
- [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) — authentication
- [NIP-45](https://github.com/nostr-protocol/nips/blob/master/45.md) — `COUNT` responses are rendered
- [NIP-50](https://github.com/nostr-protocol/nips/blob/master/50.md) — search filter

## Development

```bash
npm test          # node:test unit suite, no network required
```

Source layout:

| File | Responsibility |
| --- | --- |
| `bin/wsscope.js` | entry point |
| `src/cli.js` | argument parsing, session orchestration |
| `src/relay.js` | WebSocket connection, reconnection, counters |
| `src/render.js` | terminal formatting |
| `src/filters.js` | flags → NIP-01 filters |
| `src/auth.js` | NIP-42 event construction |
| `src/keys.js` | key parsing and display |
| `src/nip11.js` | relay information document |
| `src/kinds.js` | event kind names |
| `src/repl.js` | interactive commands |
| `src/colors.js` | ANSI styling |

## License

MIT — see [LICENSE](LICENSE).
