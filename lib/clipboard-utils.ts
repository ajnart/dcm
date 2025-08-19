/**
 * Utility function to copy text to clipboard with fallback support
 * @param text - The text to copy to clipboard
 * @returns Promise<boolean> - True if successful, false otherwise
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    // Try modern clipboard API first
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    
    // Fallback to legacy method for environments without clipboard API
    const textArea = document.createElement("textarea")
    textArea.value = text
    textArea.style.position = "fixed"
    textArea.style.left = "-999999px"
    textArea.style.top = "-999999px"
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    
    const successful = document.execCommand("copy")
    document.body.removeChild(textArea)
    
    return successful
  } catch (err) {
    console.error("Failed to copy text: ", err)
    return false
  }
}