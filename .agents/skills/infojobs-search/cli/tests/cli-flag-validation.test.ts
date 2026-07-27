import { describe, test, expect } from "bun:test"
import { runCLI } from "./helpers"

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr)
  } catch {
    return {}
  }
}

describe("InfoJobs CLI flag validation", () => {
  describe("--jobage NaN validation", () => {
    test("non-numeric string exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "camarero", "--jobage", "foo"])
      expect(result.exitCode).not.toBe(0)
      const err = parsedStderr(result.stderr)
      expect(err.code).toBe("BAD_ARG")
      expect(err.error).toMatch(/jobage/)
    })

    test("boolean flag (no value) exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "camarero", "--jobage"])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toBeTruthy()
    })
  })

  describe("--remote validation", () => {
    test("invalid mode exits 1 with BAD_ARG", async () => {
      const result = await runCLI(["search", "-q", "camarero", "--remote", "foo"])
      expect(result.exitCode).not.toBe(0)
      const err = parsedStderr(result.stderr)
      expect(err.code).toBe("BAD_ARG")
      expect(err.error).toMatch(/remote/)
    })
  })

  describe("valid flags do not produce BAD_ARG", () => {
    test("--jobage, --remote, --location accepted", async () => {
      const result = await runCLI([
        "search",
        "-q",
        "camarero",
        "--location",
        "sevilla",
        "--jobage",
        "7",
        "--remote",
        "onsite",
        "--limit",
        "1",
      ])
      const err = parsedStderr(result.stderr)
      expect(err.code).not.toBe("BAD_ARG")
    }, { timeout: 30000 })
  })
})
