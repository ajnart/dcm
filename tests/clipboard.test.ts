import { describe, expect, test } from "bun:test"
import { copyToClipboard } from "../lib/docker-compose/file-operations"
import { copyTextToClipboard } from "../lib/clipboard-utils"
import type { DockerTool } from "../lib/docker-tools"
import { DEFAULT_SETTINGS } from "../lib/constants"

// Mock document and navigator for testing
const mockDocument = {
  createElement: () => ({
    value: "",
    select: () => {},
    setSelectionRange: () => {},
    style: { position: "", left: "", top: "", opacity: "" },
  }),
  body: {
    appendChild: () => {},
    removeChild: () => {},
  },
  execCommand: () => true,
}

const mockNavigator = {
  clipboard: {
    writeText: async () => Promise.resolve(),
  },
}

describe("Clipboard functionality", () => {
  const testContent = "test content"
  const testFileType = "compose"
  const testTools: DockerTool[] = []
  const testSettings = DEFAULT_SETTINGS

  test("copyTextToClipboard with modern clipboard API", async () => {
    // Mock modern clipboard API
    global.navigator = mockNavigator as any
    global.document = mockDocument as any

    const result = await copyTextToClipboard(testContent)
    expect(result).toBe(true)
  })

  test("copyTextToClipboard without clipboard API should use fallback", async () => {
    // Mock environment without clipboard API
    global.navigator = {} as any
    global.document = mockDocument as any

    const result = await copyTextToClipboard(testContent)
    expect(result).toBe(true)
  })

  test("copyTextToClipboard should handle failure gracefully", async () => {
    // Mock environment where both clipboard API and execCommand fail
    global.navigator = {} as any
    global.document = {
      ...mockDocument,
      execCommand: () => false,
    } as any

    const result = await copyTextToClipboard(testContent)
    expect(result).toBe(false)
  })
})