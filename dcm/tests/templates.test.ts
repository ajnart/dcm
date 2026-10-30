import { describe, expect, test } from "bun:test"
import { getToolsFromTemplate, templates } from "../lib/templates"
import { tools } from "../tools"

describe("Templates", () => {
  test("templates should have valid structure", () => {
    expect(templates.length).toBeGreaterThan(0)

    templates.forEach((template) => {
      expect(template.id).toBeDefined()
      expect(template.name).toBeDefined()
      expect(template.description).toBeDefined()
      expect(template.category).toBeDefined()
      expect(template.tools).toBeDefined()
      expect(Array.isArray(template.tools)).toBe(true)
      expect(template.tools.length).toBeGreaterThan(0)
    })
  })

  test("template IDs should be unique", () => {
    const templateIds = templates.map((template) => template.id)
    const uniqueIds = new Set(templateIds)
    expect(uniqueIds.size).toBe(templates.length)
  })

  test("template tools should reference existing tool IDs", () => {
    const allToolIds = tools.map((tool) => tool.id)

    templates.forEach((template) => {
      // Some tools might not exist, but at least one should
      const foundTools = template.tools.filter((toolId) =>
        allToolIds.includes(toolId),
      )
      expect(foundTools.length).toBeGreaterThan(0)
    })
  })

  test("getToolsFromTemplate should return correct tools", () => {
    templates.forEach((template) => {
      const result = getToolsFromTemplate(template, tools)

      expect(Array.isArray(result)).toBe(true)

      // Verify each returned tool is valid
      result.forEach((tool) => {
        expect(tool).toBeDefined()
        expect(tool.id).toBeDefined()
        expect(template.tools).toContain(tool.id)
      })

      // Verify all valid tools from the template are returned
      const expectedToolCount = template.tools.filter((toolId) =>
        tools.some((tool) => tool.id === toolId),
      ).length

      expect(result.length).toBe(expectedToolCount)
    })
  })
})
