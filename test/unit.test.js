import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildFilters, parsePubkey, parseTime } from '../src/filters.js'
import { normaliseUrl } from '../src/cli.js'
import { toHttpUrl } from '../src/nip11.js'
import { describeKind, kindClass } from '../src/kinds.js'
import { parseSecretKey, shortHex } from '../src/keys.js'
import { buildAuthEvent } from '../src/auth.js'
import { backoffDelay } from '../src/relay.js'
import { oneLine, eventMarkers, humanBytes } from '../src/render.js'
import { setColorEnabled, stripAnsi, c } from '../src/colors.js'
import { generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools'

setColorEnabled(false)

test('normaliseUrl adds and converts schemes', () => {
  assert.equal(normaliseUrl('wss://relay.example'), 'wss://relay.example')
  assert.equal(normaliseUrl('ws://relay.example'), 'ws://relay.example')
  assert.equal(normaliseUrl('relay.example'), 'wss://relay.example')
  assert.equal(normaliseUrl('https://relay.example'), 'wss://relay.example')
  assert.equal(normaliseUrl('http://relay.example'), 'ws://relay.example')
})

test('toHttpUrl flips the websocket scheme', () => {
  assert.equal(toHttpUrl('wss://relay.example/path'), 'https://relay.example/path')
  assert.equal(toHttpUrl('ws://relay.example'), 'http://relay.example/')
})

test('parseTime handles durations and unix timestamps', () => {
  const now = 1_000_000
  assert.equal(parseTime('30s', now), now - 30)
  assert.equal(parseTime('15m', now), now - 900)
  assert.equal(parseTime('2h', now), now - 7200)
  assert.equal(parseTime('7d', now), now - 604800)
  assert.equal(parseTime('1w', now), now - 604800)
  assert.equal(parseTime('1700000000', now), 1_700_000_000)
  assert.throws(() => parseTime('tomorrow', now), /invalid time/)
})

test('parsePubkey accepts npub and hex', () => {
  const secret = generateSecretKey()
  const pubkey = getPublicKey(secret)
  assert.equal(parsePubkey(pubkey), pubkey)
  assert.equal(parsePubkey(nip19.npubEncode(pubkey)), pubkey)
  assert.throws(() => parsePubkey('nope'), /invalid pubkey/)
})

test('buildFilters merges shorthand flags into one filter', () => {
  const filters = buildFilters({ kinds: '1,7', limit: '10', group: ['abc'], tag: ['t=intro'] })
  assert.equal(filters.length, 1)
  assert.deepEqual(filters[0].kinds, [1, 7])
  assert.equal(filters[0].limit, 10)
  assert.deepEqual(filters[0]['#h'], ['abc'])
  assert.deepEqual(filters[0]['#t'], ['intro'])
})

test('buildFilters keeps raw --filter entries verbatim and appends shorthand', () => {
  const filters = buildFilters({ filter: ['{"kinds":[0]}', '[{"kinds":[3]}]'], limit: '5' })
  assert.deepEqual(filters, [{ kinds: [0] }, { kinds: [3] }, { limit: 5 }])
})

test('buildFilters returns nothing when no flags are given', () => {
  assert.deepEqual(buildFilters({}), [])
})

test('buildFilters rejects malformed input', () => {
  assert.throws(() => buildFilters({ filter: ['{oops'] }), /not valid JSON/)
  assert.throws(() => buildFilters({ tag: ['novalue'] }), /name=value/)
  assert.throws(() => buildFilters({ kinds: 'abc' }), /invalid kind/)
  assert.throws(() => buildFilters({ limit: '-3' }), /invalid --limit/)
})

test('parseSecretKey round-trips nsec and hex', () => {
  const secret = generateSecretKey()
  const nsec = nip19.nsecEncode(secret)
  const fromNsec = parseSecretKey(nsec)
  const hex = Buffer.from(secret).toString('hex')
  const fromHex = parseSecretKey(hex)
  assert.equal(fromNsec.pubkey, fromHex.pubkey)
  assert.match(fromNsec.npub, /^npub1/)
  assert.throws(() => parseSecretKey('not-a-key'), /nsec1/)
})

test('buildAuthEvent produces a valid signed kind 22242 event', () => {
  const secret = generateSecretKey()
  const relayUrl = 'wss://relay.example'
  const challenge = 'abc123'
  const event = buildAuthEvent({ relayUrl, challenge, secret })
  assert.equal(event.kind, 22242)
  assert.equal(event.pubkey, getPublicKey(secret))
  assert.ok(verifyEvent(event))
  assert.deepEqual(
    event.tags.find((t) => t[0] === 'challenge'),
    ['challenge', challenge],
  )
  assert.equal(event.tags.find((t) => t[0] === 'relay')?.[1], relayUrl)
})

test('describeKind names what it knows and passes through what it does not', () => {
  assert.equal(describeKind(1), '1 Short Text Note')
  assert.equal(describeKind(9), '9 Group Chat Message')
  assert.equal(describeKind(1059), '1059 Gift Wrap')
  assert.equal(describeKind(918273), '918273')
})

test('kindClass follows NIP-01 ranges', () => {
  assert.equal(kindClass(0), 'replaceable')
  assert.equal(kindClass(1), 'regular')
  assert.equal(kindClass(10002), 'replaceable')
  assert.equal(kindClass(22242), 'ephemeral')
  assert.equal(kindClass(30023), 'addressable')
})

test('backoffDelay grows and stays capped', () => {
  const first = backoffDelay(1, 30_000)
  const later = backoffDelay(10, 30_000)
  assert.ok(first >= 800 && first <= 1300, `unexpected first delay ${first}`)
  assert.ok(later <= 30_000 && later >= 25_000, `unexpected capped delay ${later}`)
})

test('oneLine collapses whitespace and clips', () => {
  assert.equal(oneLine('a\n\n  b   c'), 'a b c')
  assert.equal(oneLine('abcdefghij', 5), 'abcd…')
})

test('eventMarkers surfaces the interesting tags', () => {
  const marks = eventMarkers({
    tags: [
      ['h', 'group-1'],
      ['e', 'aa'],
      ['e', 'bb'],
      ['p', 'cc'],
      ['subject', 'Hello'],
    ],
  })
  assert.deepEqual(marks, ['h:group-1', 'e×2', 'p×1', 'subject:Hello'])
})

test('shortHex and humanBytes format for display', () => {
  assert.equal(shortHex('a'.repeat(64)), 'aaaaaaaa…aaaaaaaa')
  assert.equal(shortHex('abc'), 'abc')
  assert.equal(humanBytes(512), '512 B')
  assert.equal(humanBytes(2048), '2.0 KB')
  assert.equal(humanBytes(3 * 1024 * 1024), '3.0 MB')
})

test('colour can be disabled', () => {
  setColorEnabled(false)
  assert.equal(c.red('x'), 'x')
  setColorEnabled(true)
  assert.notEqual(c.red('x'), 'x')
  assert.equal(stripAnsi(c.red('x')), 'x')
  setColorEnabled(false)
})
