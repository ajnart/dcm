import { describe, test } from "bun:test"
import {
  getValidationSummary,
  isContainerValid,
  validateAllContainers,
} from "../lib/container-validator"

describe("Container Validation", () => {
  const results = validateAllContainers()

  test("all containers should be valid", () => {
    const invalidContainers = results.filter(
      (result) => !isContainerValid(result),
    )

    if (invalidContainers.length > 0) {
      const errorMessages = invalidContainers
        .map((result) => {
          return `Container ${result.containerName} (${result.containerId}) has validation issues:\n${getValidationSummary(result)}`
        })
        .join("\n\n")

      throw new Error(`Found invalid containers:\n\n${errorMessages}`)
    }
  })
})
