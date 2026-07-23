import { kinds as knownKinds } from 'nostr-tools'

/** number -> human name, derived from nostr-tools' name -> number map. */
const BY_NUMBER = new Map()
for (const [name, value] of Object.entries(knownKinds)) {
  if (typeof value === 'number' && !BY_NUMBER.has(value)) {
    BY_NUMBER.set(value, splitCamel(name))
  }
}

/** Kinds nostr-tools doesn't name, plus NIP-29 relay-based groups. */
const EXTRA = new Map([
  [9, 'Group Chat Message'],
  [10, 'Group Chat Threaded Reply'],
  [11, 'Group Thread'],
  [12, 'Group Thread Reply'],
  [17, 'Reaction To Website'],
  [1059, 'Gift Wrap'],
  [9000, 'Group Add User'],
  [9001, 'Group Remove User'],
  [9002, 'Group Edit Metadata'],
  [9005, 'Group Delete Event'],
  [9007, 'Group Create'],
  [9008, 'Group Delete'],
  [9021, 'Group Join Request'],
  [9022, 'Group Leave Request'],
  [39000, 'Group Metadata'],
  [39001, 'Group Admins'],
  [39002, 'Group Members'],
  [39003, 'Group Roles'],
])

export function kindName(kind) {
  return EXTRA.get(kind) ?? BY_NUMBER.get(kind) ?? null
}

export function describeKind(kind) {
  const name = kindName(kind)
  return name ? `${kind} ${name}` : String(kind)
}

/** Rough NIP-01 classification, useful context when a kind is unnamed. */
export function kindClass(kind) {
  if (kind === 0 || kind === 3) return 'replaceable'
  if (kind >= 1000 && kind < 10000) return 'regular'
  if (kind >= 10000 && kind < 20000) return 'replaceable'
  if (kind >= 20000 && kind < 30000) return 'ephemeral'
  if (kind >= 30000 && kind < 40000) return 'addressable'
  return 'regular'
}

function splitCamel(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}
