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

/**
 * Decodes a share parameter back into an array of tool IDs
 */
export function decodeShareUrl(shareParam: string): string[] {
  if (!shareParam) return []

  try {
    // Make the base64 URL-safe format back to regular base64
    const base64 = shareParam.replace(/-/g, "+").replace(/_/g, "/")

    // Add back any missing padding
    const padding = base64.length % 4
    const paddedBase64 = padding ? base64 + "=".repeat(4 - padding) : base64

    // Decode and parse JSON
    const jsonString = atob(paddedBase64)
    const toolIds = JSON.parse(jsonString)

    return Array.isArray(toolIds) ? toolIds : []
  } catch (error) {
    console.error("Error decoding share URL:", error)
    return []
  }
}

/**
 * Generates a full share URL with the encoded tools parameter
 */
export function generateShareUrl(toolIds: string[]): string {
  if (!toolIds.length) return window.location.origin

  const encoded = encodeShareUrl(toolIds)
  const url = new URL(window.location.origin)

  // Set the share parameter in the URL
  if (encoded) {
    url.searchParams.set("share", encoded)
  }

  return url.toString()
}
