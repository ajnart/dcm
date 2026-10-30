import { type CatalogMode, MODE_PATHS } from "@/lib/modes"

/**
 * Encodes an array of tool IDs into a compressed URL-safe string
 */
export function encodeShareUrl(toolIds: string[]): string {
  if (!toolIds.length) return ""

  // Convert array to JSON and encode
  const jsonString = JSON.stringify(toolIds)

  try {
    // Use base64 encoding and make it URL-safe
    const encoded = btoa(jsonString)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

    return encoded
  } catch (error) {
    console.error("Error encoding share URL:", error)
    return ""
  }
}

const MAX_SHARE_PARAM_LENGTH = 16_000
const MAX_SHARED_IDS = 200

/**
 * Decodes a share parameter back into the tool IDs the catalog knows, without
 * duplicates and at most MAX_SHARED_IDS of them
 */
export function decodeShareUrl(
  shareParam: string,
  knownIds: ReadonlySet<string>,
): string[] {
  if (!shareParam || shareParam.length > MAX_SHARE_PARAM_LENGTH) return []

  try {
    // Make the base64 URL-safe format back to regular base64
    const base64 = shareParam.replace(/-/g, "+").replace(/_/g, "/")

    // Add back any missing padding
    const padding = base64.length % 4
    const paddedBase64 = padding ? base64 + "=".repeat(4 - padding) : base64

    // Decode and parse JSON
    const jsonString = atob(paddedBase64)
    const parsed: unknown = JSON.parse(jsonString)
    if (!Array.isArray(parsed)) return []

    const ids = new Set<string>()
    for (const value of parsed) {
      if (typeof value === "string" && knownIds.has(value)) ids.add(value)
      if (ids.size === MAX_SHARED_IDS) break
    }
    return [...ids]
  } catch (error) {
    console.error("Error decoding share URL:", error)
    return []
  }
}

/**
 * Generates a full share URL with the encoded tools parameter
 */
export function generateShareUrl(toolIds: string[], mode: CatalogMode): string {
  const url = new URL(MODE_PATHS[mode], window.location.origin)
  if (!toolIds.length) return url.toString()

  const encoded = encodeShareUrl(toolIds)

  // Set the share parameter in the URL
  if (encoded) {
    url.searchParams.set("share", encoded)
  }

  return url.toString()
}
