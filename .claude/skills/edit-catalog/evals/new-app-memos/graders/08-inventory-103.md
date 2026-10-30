---
type: llm
focus: trace
weight: 1
---

e2e/acceptance_fixture_test.go expects 103 targets, e2e/testdata/inventory.json lists memos, and go test ./e2e/ -run TestAcceptanceInventory passes
