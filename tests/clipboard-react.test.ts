import { describe, expect, test } from "bun:test"

// Mock navigator for testing
const mockNavigator = {
  clipboard: {
    writeText: async (text: string) => Promise.resolve(),
  },
}

const mockNavigatorFailing = {
  clipboard: {
    writeText: async (text: string) => Promise.reject(new Error("Clipboard not available")),
  },
}

describe("Clipboard functionality", () => {
  test("should detect when clipboard API is available", async () => {
    global.navigator = mockNavigator as any
    
    // Test that clipboard check works
    const hasClipboard = !!navigator.clipboard?.writeText
    expect(hasClipboard).toBe(true)
  })

  test("should detect when clipboard API is not available", async () => {
    global.navigator = {} as any
    
    // Test that clipboard check works
    const hasClipboard = !!navigator.clipboard?.writeText
    expect(hasClipboard).toBe(false)
  })

  test("should throw proper error when clipboard API fails", async () => {
    global.navigator = mockNavigatorFailing as any
    
    try {
      await navigator.clipboard.writeText("test")
      expect.fail("Should have thrown an error")
    } catch (err) {
      expect(err instanceof Error).toBe(true)
      expect((err as Error).message).toBe("Clipboard not available")
    }
  })
})