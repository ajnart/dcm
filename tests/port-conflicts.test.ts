import { describe, expect, test } from "bun:test"
import { detectAndFixPortConflicts } from "../lib/docker-compose/port-conflicts"

describe("Port Conflict Detection and Resolution", () => {
  test("should detect no conflicts when ports are unique", () => {
    const content = `services:
  service1:
    ports:
      - "8080:8080"
  service2:
    ports:
      - "8081:8081"`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).toBeNull()
    expect(fixedContent).toBe(content)
  })

  test("should detect and fix simple port conflict", () => {
    const content = `services:
  service1:
    ports:
      - "8080:8080"
  service2:
    ports:
      - "8080:8080"`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    expect(conflicts?.fixed).toBe(1)
    expect(conflicts?.conflicts.length).toBe(1)
    expect(conflicts?.conflicts[0]).toContain("Port 8080 was used by: service1, service2")
    expect(conflicts?.conflicts[0]).toContain("Changed service2: 8080 → 8081")
    expect(fixedContent).toContain("8081:8080")
  })

  test("should detect and fix multiple port conflicts", () => {
    const content = `services:
  service1:
    ports:
      - "8080:8080"
      - "9090:9090"
  service2:
    ports:
      - "8080:8080"
      - "9090:9090"`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    expect(conflicts?.fixed).toBe(2)
    expect(conflicts?.conflicts.length).toBe(2)
  })

  test("should detect conflicts with three or more services", () => {
    const content = `services:
  service1:
    ports:
      - "8080:8080"
  service2:
    ports:
      - "8080:8080"
  service3:
    ports:
      - "8080:8080"`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    expect(conflicts?.fixed).toBe(2)
    expect(conflicts?.conflicts[0]).toContain("service1, service2, service3")
    expect(fixedContent).toContain("8081:8080")
    expect(fixedContent).toContain("8082:8080")
  })

  test("should handle ports with quotes", () => {
    const content = `services:
  service1:
    ports:
      - "8080:8080"
  service2:
    ports:
      - '8080:8080'`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    expect(conflicts?.fixed).toBe(1)
  })

  test("should handle ports without quotes", () => {
    const content = `services:
  service1:
    ports:
      - 8080:8080
  service2:
    ports:
      - 8080:8080`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    expect(conflicts?.fixed).toBe(1)
  })

  test("should not conflict when only internal ports match", () => {
    const content = `services:
  service1:
    ports:
      - "8080:80"
  service2:
    ports:
      - "8081:80"`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).toBeNull()
  })

  test("should handle services with multiple ports", () => {
    const content = `services:
  service1:
    ports:
      - "8080:8080"
      - "8081:8081"
  service2:
    ports:
      - "8082:8082"
      - "8081:443"`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    expect(conflicts?.fixed).toBe(1)
    expect(conflicts?.conflicts[0]).toContain("Port 8081")
  })

  test("should find next available port when consecutive ports are taken", () => {
    const content = `services:
  service1:
    ports:
      - "8080:8080"
  service2:
    ports:
      - "8081:8081"
  service3:
    ports:
      - "8080:80"`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    // service3 should get 8082 since 8081 is already taken
    expect(fixedContent).toContain("8082:80")
  })

  test("should preserve service structure and comments", () => {
    const content = `services:
  # Service 1 comment
  service1:
    image: nginx
    ports:
      - "8080:80"
  # Service 2 comment
  service2:
    image: apache
    ports:
      - "8080:80"`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    expect(fixedContent).toContain("# Service 1 comment")
    expect(fixedContent).toContain("# Service 2 comment")
  })

  test("should handle complex docker-compose file", () => {
    const content = `services:
  web:
    image: nginx
    container_name: web
    environment:
      - NGINX_PORT=80
    ports:
      - "80:80"
      - "443:443"
  api:
    image: node:latest
    ports:
      - "3000:3000"
  database:
    image: postgres
    ports:
      - "80:5432"
    environment:
      - POSTGRES_PASSWORD=secret`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    expect(conflicts?.conflicts[0]).toContain("Port 80 was used by: web, database")
    expect(fixedContent).toContain("81:5432")
  })

  test("should track correct service names in detailed conflicts", () => {
    const content = `services:
  jellyfin:
    ports:
      - "8096:8096"
  plex:
    ports:
      - "8096:3005"
  emby:
    ports:
      - "8096:8096"`

    const { fixedContent, conflicts } = detectAndFixPortConflicts(content)

    expect(conflicts).not.toBeNull()
    expect(conflicts?.detailedConflicts.length).toBe(1)

    const conflict = conflicts!.detailedConflicts[0]
    expect(conflict.port).toBe("8096")
    expect(conflict.affectedServices).toEqual(["jellyfin", "plex", "emby"])
    expect(conflict.keptService).toBe("jellyfin")
    expect(conflict.changes.length).toBe(2)

    // Check that each change has the correct service name
    const changeServices = conflict.changes.map((c) => c.service)
    expect(changeServices).toContain("plex")
    expect(changeServices).toContain("emby")

    // plex should be changed to 8097, emby to 8098
    const plexChange = conflict.changes.find((c) => c.service === "plex")
    const embyChange = conflict.changes.find((c) => c.service === "emby")

    expect(plexChange?.newPort).toBe("8097")
    expect(embyChange?.newPort).toBe("8098")
  })
})
