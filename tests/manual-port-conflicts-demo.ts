/**
 * Manual test script to demonstrate enhanced port conflict detection
 * Run with: bun run tests/manual-port-conflicts-demo.ts
 */

import { detectAndFixPortConflicts } from "../lib/docker-compose/port-conflicts"

console.log("=".repeat(80))
console.log("PORT CONFLICT DETECTION - MANUAL DEMONSTRATION")
console.log("=".repeat(80))
console.log()

// Test case 1: Simple conflict between two services
console.log("Test 1: Simple port conflict between two services")
console.log("-".repeat(80))
const test1 = `services:
  nginx:
    image: nginx
    ports:
      - "8080:80"
  apache:
    image: httpd
    ports:
      - "8080:80"`

const result1 = detectAndFixPortConflicts(test1)
console.log("BEFORE:")
console.log(test1)
console.log()
console.log("AFTER:")
console.log(result1.fixedContent)
console.log()
console.log("DETAILED CONFLICT INFO:")
if (result1.conflicts) {
  console.log(`- Fixed ${result1.conflicts.fixed} conflict(s)`)
  console.log(`- Total conflicts: ${result1.conflicts.detailedConflicts.length}`)
  for (const conflict of result1.conflicts.detailedConflicts) {
    console.log(`\n  Port ${conflict.port}:`)
    console.log(`    Affected services: ${conflict.affectedServices.join(", ")}`)
    console.log(`    Kept service: ${conflict.keptService}`)
    console.log("    Changes made:")
    for (const change of conflict.changes) {
      console.log(
        `      - ${change.service}: ${change.oldPort} → ${change.newPort}`,
      )
    }
  }
}
console.log()
console.log("=".repeat(80))
console.log()

// Test case 2: Multiple conflicts
console.log("Test 2: Multiple port conflicts")
console.log("-".repeat(80))
const test2 = `services:
  jellyfin:
    image: jellyfin/jellyfin
    ports:
      - "8096:8096"
      - "7359:7359"
  plex:
    image: plexinc/pms-docker
    ports:
      - "32400:32400"
      - "8096:3005"
  emby:
    image: emby/embyserver
    ports:
      - "8096:8096"
      - "8920:8920"`

const result2 = detectAndFixPortConflicts(test2)
console.log("BEFORE:")
console.log(test2)
console.log()
console.log("AFTER:")
console.log(result2.fixedContent)
console.log()
console.log("DETAILED CONFLICT INFO:")
if (result2.conflicts) {
  console.log(`- Fixed ${result2.conflicts.fixed} conflict(s)`)
  console.log(`- Total conflicts: ${result2.conflicts.detailedConflicts.length}`)
  for (const conflict of result2.conflicts.detailedConflicts) {
    console.log(`\n  Port ${conflict.port}:`)
    console.log(`    Affected services: ${conflict.affectedServices.join(", ")}`)
    console.log(`    Kept service: ${conflict.keptService}`)
    console.log("    Changes made:")
    for (const change of conflict.changes) {
      console.log(
        `      - ${change.service}: ${change.oldPort} → ${change.newPort}`,
      )
    }
  }
}
console.log()
console.log("=".repeat(80))
console.log()

// Test case 3: Three-way conflict
console.log("Test 3: Three services conflicting on same port")
console.log("-".repeat(80))
const test3 = `services:
  service1:
    image: nginx
    ports:
      - "9000:80"
  service2:
    image: httpd
    ports:
      - "9000:80"
  service3:
    image: caddy
    ports:
      - "9000:80"`

const result3 = detectAndFixPortConflicts(test3)
console.log("BEFORE:")
console.log(test3)
console.log()
console.log("AFTER:")
console.log(result3.fixedContent)
console.log()
console.log("DETAILED CONFLICT INFO:")
if (result3.conflicts) {
  console.log(`- Fixed ${result3.conflicts.fixed} conflict(s)`)
  console.log(`- Total conflicts: ${result3.conflicts.detailedConflicts.length}`)
  for (const conflict of result3.conflicts.detailedConflicts) {
    console.log(`\n  Port ${conflict.port}:`)
    console.log(`    Affected services: ${conflict.affectedServices.join(", ")}`)
    console.log(`    Kept service: ${conflict.keptService}`)
    console.log("    Changes made:")
    for (const change of conflict.changes) {
      console.log(
        `      - ${change.service}: ${change.oldPort} → ${change.newPort}`,
      )
    }
  }
}
console.log()
console.log("=".repeat(80))
console.log()

console.log("✅ All demonstrations completed successfully!")
console.log()
console.log("KEY FEATURES DEMONSTRATED:")
console.log("1. ✅ Shows which containers have port conflicts")
console.log("2. ✅ Identifies which service keeps the original port")
console.log("3. ✅ Provides suggested alternative ports for conflicting services")
console.log("4. ✅ Detailed structured data for UI visualization")
console.log()
