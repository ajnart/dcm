import { describe, expect, test } from "bun:test"
import { composeContentSchema, validateComposeContent } from "../lib/docker-tools"

describe("Docker Compose Networks Validation", () => {
  test("should validate the exact example from issue (erugo app with networks)", () => {
    // This is the exact example from the bug report
    const composeFromIssue = `services:
  app:
    image: wardy784/erugo:latest
    restart: unless-stopped
    volumes:
      - ./erugo-storage:/var/www/html/storage # Use a dedicated folder
    ports:
      - '9998:80'
    networks:
      - erugo

networks:
  erugo:
    driver: bridge`

    // Test with schema
    const schemaResult = composeContentSchema.safeParse(composeFromIssue)
    expect(schemaResult.success).toBe(true)

    // Test with validation function
    const validationResult = validateComposeContent(composeFromIssue)
    expect(validationResult.isValid).toBe(true)
    expect(validationResult.errors.length).toBe(0)
  })

  test("should validate compose with networks section", () => {
    const composeWithNetworks = `services:
  app:
    image: wardy784/erugo:latest
    restart: unless-stopped
    volumes:
      - ./erugo-storage:/var/www/html/storage
    ports:
      - '9998:80'
    networks:
      - erugo

networks:
  erugo:
    driver: bridge`

    // Test with schema
    const schemaResult = composeContentSchema.safeParse(composeWithNetworks)
    expect(schemaResult.success).toBe(true)

    // Test with validation function
    const validationResult = validateComposeContent(composeWithNetworks)
    expect(validationResult.isValid).toBe(true)
    expect(validationResult.errors.length).toBe(0)
  })

  test("should validate compose with volumes section", () => {
    const composeWithVolumes = `services:
  app:
    image: nginx:latest
    volumes:
      - data:/data

volumes:
  data:
    driver: local`

    const schemaResult = composeContentSchema.safeParse(composeWithVolumes)
    expect(schemaResult.success).toBe(true)

    const validationResult = validateComposeContent(composeWithVolumes)
    expect(validationResult.isValid).toBe(true)
    expect(validationResult.errors.length).toBe(0)
  })

  test("should validate compose with both networks and volumes sections", () => {
    const composeWithBoth = `services:
  app:
    image: nginx:latest
    volumes:
      - data:/data
    networks:
      - frontend

networks:
  frontend:
    driver: bridge

volumes:
  data:
    driver: local`

    const schemaResult = composeContentSchema.safeParse(composeWithBoth)
    expect(schemaResult.success).toBe(true)

    const validationResult = validateComposeContent(composeWithBoth)
    expect(validationResult.isValid).toBe(true)
    expect(validationResult.errors.length).toBe(0)
  })

  test("should validate compose with external network", () => {
    const composeWithExternalNetwork = `services:
  app:
    image: nginx:latest
    networks:
      - mynet

networks:
  mynet:
    external: true`

    const schemaResult = composeContentSchema.safeParse(composeWithExternalNetwork)
    expect(schemaResult.success).toBe(true)

    const validationResult = validateComposeContent(composeWithExternalNetwork)
    expect(validationResult.isValid).toBe(true)
    expect(validationResult.errors.length).toBe(0)
  })

  test("should reject compose with incorrect service indentation", () => {
    const invalidIndentation = `services:
 app:
    image: nginx:latest`

    const schemaResult = composeContentSchema.safeParse(invalidIndentation)
    expect(schemaResult.success).toBe(false)
  })

  test("should reject compose with incorrect property indentation", () => {
    const invalidIndentation = `services:
  app:
   image: nginx:latest`

    const schemaResult = composeContentSchema.safeParse(invalidIndentation)
    expect(schemaResult.success).toBe(false)
  })

  test("should reject compose with 3 space indentation for services", () => {
    const invalidIndentation = `services:
   app:
    image: nginx:latest`

    const schemaResult = composeContentSchema.safeParse(invalidIndentation)
    expect(schemaResult.success).toBe(false)
  })
})
