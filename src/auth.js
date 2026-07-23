import { finalizeEvent, nip42 } from 'nostr-tools'

/**
 * NIP-42 — build the signed kind 22242 event that answers a relay's
 * `["AUTH", <challenge>]` frame.
 */
export function buildAuthEvent({ relayUrl, challenge, secret }) {
  const template = nip42.makeAuthEvent(relayUrl, challenge)
  return finalizeEvent(template, secret)
}

export function authMessage(event) {
  return ['AUTH', event]
}
