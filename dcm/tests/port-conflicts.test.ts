import { describe, expect, test } from "bun:test"
import { detectAndFixPortConflicts } from "../src/lib/docker-compose/port-conflicts"

function compose(first: string, second: string): string {
  return `services:
  app-one:
    image: one
    ports:
      - "8080:80"
${first}
  app-two:
    image: two
    ports:
      - "8080:80"
${second}
volumes:
  data:
`
}

describe("detectAndFixPortConflicts", () => {
  test("rewrites the old host port in the moved service's environment URLs", () => {
    const { fixedContent, conflicts } = detectAndFixPortConflicts(
      compose(
        "    environment:\n      APP_URL: http://${LAN_IP}:8080",
        "    environment:\n      APP_URL: http://${LAN_IP}:8080\n      OTHER: http://${LAN_IP:-localhost}:8080/path",
      ),
    )

    expect(conflicts?.fixed).toBe(1)
    expect(fixedContent).toContain('      - "8081:80"')
    expect(fixedContent).toContain("      APP_URL: http://${LAN_IP}:8081")
    expect(fixedContent).toContain(
      "      OTHER: http://${LAN_IP:-localhost}:8081/path",
    )
  })

  test("handles list-style environment", () => {
    const { fixedContent } = detectAndFixPortConflicts(
      compose(
        "    environment:\n      - APP_URL=http://${LAN_IP}:8080",
        "    environment:\n      - APP_URL=http://${LAN_IP}:8080",
      ),
    )

    const [one, two] = fixedContent.split("  app-two:")
    expect(one).toContain("APP_URL=http://${LAN_IP}:8080")
    expect(two).toContain("APP_URL=http://${LAN_IP}:8081")
  })

  test("leaves the kept service and container-side or unrelated ports alone", () => {
    const keptEnvironment =
      "    environment:\n      APP_URL: http://${LAN_IP}:8080"
    const movedEnvironment = [
      "    environment:",
      "      INTERNAL: http://localhost:8080",
      "      BIND: 0.0.0.0:8080",
      "      UPSTREAM: http://app-one:80",
      "      DATABASE: ${DB_HOST}:8080",
      "      LONGER: http://${LAN_IP}:80800",
      "      CONTAINER: http://${LAN_IP}:80",
    ].join("\n")

    const { fixedContent } = detectAndFixPortConflicts(
      compose(keptEnvironment, movedEnvironment),
    )

    const [one, two] = fixedContent.split("  app-two:")
    expect(one).toContain("APP_URL: http://${LAN_IP}:8080")
    expect(two).toContain("INTERNAL: http://localhost:8080")
    expect(two).toContain("BIND: 0.0.0.0:8080")
    expect(two).toContain("UPSTREAM: http://app-one:80")
    expect(two).toContain("DATABASE: ${DB_HOST}:8080")
    expect(two).toContain("LONGER: http://${LAN_IP}:80800")
    expect(two).toContain("CONTAINER: http://${LAN_IP}:80")
    expect(two).not.toContain(":8081\n      INTERNAL")
  })

  test("only rewrites the environment block, not other properties", () => {
    const { fixedContent } = detectAndFixPortConflicts(
      compose(
        "    environment:\n      APP_URL: http://${LAN_IP}:8080",
        "    labels:\n      note: http://${LAN_IP}:8080",
      ),
    )

    const [, two] = fixedContent.split("  app-two:")
    expect(two).toContain("note: http://${LAN_IP}:8080")
  })
})
