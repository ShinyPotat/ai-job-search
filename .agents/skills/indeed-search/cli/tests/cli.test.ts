import { describe, expect, test } from "bun:test"
import { parseFlags } from "../src/flags.ts"

function runCLI(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", "src/cli.ts", ...args],
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    })

    let stdout = ""
    let stderr = ""

    const readerOut = proc.stdout.getReader()
    const readerErr = proc.stderr.getReader()

    function readOut(): Promise<void> {
      return readerOut.read().then(({ done, value }) => {
        if (done) return
        stdout += new TextDecoder().decode(value)
        return readOut()
      })
    }

    function readErr(): Promise<void> {
      return readerErr.read().then(({ done, value }) => {
        if (done) return
        stderr += new TextDecoder().decode(value)
        return readErr()
      })
    }

    Promise.all([readOut(), readErr()]).then(() => {
      proc.exited.then((exitCode) => {
        resolve({ exitCode, stdout, stderr })
      })
    })
  })
}

function parsedStderr(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr.trim().split("\n").pop() || "{}")
  } catch {
    return {}
  }
}

describe("parseFlags", () => {
  test("parses long flags", () => {
    const flags = parseFlags([
      "search",
      "--query",
      "enfermera",
      "--location",
      "sevilla",
      "--page",
      "2",
      "--limit",
      "5",
      "--jobage",
      "7",
      "--format",
      "table",
    ])
    expect(flags._).toEqual(["search"])
    expect(flags.query).toBe("enfermera")
    expect(flags.location).toBe("sevilla")
    expect(flags.page).toBe("2")
    expect(flags.limit).toBe("5")
    expect(flags.jobage).toBe("7")
    expect(flags.format).toBe("table")
  })

  test("parses short aliases", () => {
    const flags = parseFlags(["search", "-q", "enfermera", "-n", "5"])
    expect(flags.query).toBe("enfermera")
    expect(flags.limit).toBe("5")
  })

  test("parses boolean flags", () => {
    const flags = parseFlags(["search", "--help"])
    expect(flags._).toEqual(["search"])
    expect(flags.help).toBe(true)
  })

  test("collects positional args", () => {
    const flags = parseFlags(["detail", "abc123def456"])
    expect(flags._).toEqual(["detail", "abc123def456"])
  })
})

describe("CLI error codes", () => {
  test("NO_QUERY when search lacks --query", async () => {
    const result = await runCLI(["search"])
    expect(result.exitCode).not.toBe(0)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("NO_QUERY")
  })

  test("NO_ID when detail lacks id", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).not.toBe(0)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("NO_ID")
  })

  test("BAD_ARG for non-numeric --page", async () => {
    const result = await runCLI(["search", "--query", "enfermera", "--page", "abc"])
    expect(result.exitCode).not.toBe(0)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("BAD_ARG for non-numeric --limit", async () => {
    const result = await runCLI(["search", "--query", "enfermera", "--limit", "xyz"])
    expect(result.exitCode).not.toBe(0)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("BAD_ARG for non-numeric --jobage", async () => {
    const result = await runCLI(["search", "--query", "enfermera", "--jobage", "abc"])
    expect(result.exitCode).not.toBe(0)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("BAD_ARG when --page is passed as boolean", async () => {
    const result = await runCLI(["search", "--query", "enfermera", "--page"])
    expect(result.exitCode).not.toBe(0)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("BAD_CMD for unknown subcommand", async () => {
    const result = await runCLI(["unknown"])
    expect(result.exitCode).not.toBe(0)
    const err = parsedStderr(result.stderr)
    expect(err.code).toBe("BAD_CMD")
  })

  test("prints help for --help", async () => {
    const result = await runCLI(["search", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("USAGE")
  })
})

