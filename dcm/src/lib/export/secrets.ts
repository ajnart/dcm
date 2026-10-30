import type { SecretFor } from "./types"

function hexOf(values: Uint8Array): string {
  return Array.from(values, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
}

export const freshSecret: SecretFor = (_key, bytes) =>
  hexOf(crypto.getRandomValues(new Uint8Array(bytes)))

const remembered = new Map<string, string>()

export const pageSecret: SecretFor = (key, bytes) => {
  const id = `${key}:${bytes}`
  const known = remembered.get(id)
  if (known) return known
  const secret = freshSecret(key, bytes)
  remembered.set(id, secret)
  return secret
}
