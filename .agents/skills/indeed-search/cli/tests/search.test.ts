import { afterEach, describe, expect, mock, test } from "bun:test"
import * as helpers from "../src/helpers.ts"

const mockFetchSearchPage = mock((url: string) =>
  Promise.resolve({
    markdown: "",
    html: `<a href="/rc/clk?jk=abc123def456">job</a>`,
  }),
)

mock.module("../src/helpers.js", () => ({
  ...helpers,
  fetchSearchPage: mockFetchSearchPage,
}))

const searchModule = await import("../src/commands/search.ts")
const { runSearch, buildUrl } = searchModule

describe("buildUrl", () => {
  test("uses buildUrl from helpers", () => {
    expect(buildUrl({ query: "enfermera", location: "sevilla" })).toBe(
      "https://es.indeed.com/jobs?q=enfermera&l=sevilla",
    )
  })
})

describe("runSearch", () => {
  const originalStdoutWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    mockFetchSearchPage.mockClear()
  })

  test("emits json by default and returns 0", async () => {
    let stdout = ""
    let stderr = ""
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += chunk.toString()
      return true
    }) as typeof process.stderr.write

    const result = await runSearch({ query: "enfermera", page: 1, format: "json" })

    expect(result).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.meta).toEqual({
      count: 0,
      page: 1,
      query: "enfermera",
    })
    expect(parsed.results).toEqual([])
  })

  test("filters by age and limit", async () => {
    let stdout = ""
    let stderr = ""
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += chunk.toString()
      return true
    }) as typeof process.stderr.write

    mockFetchSearchPage.mockResolvedValueOnce({
      markdown: `
## Enfermera/a
### Clínica Norte
- Madrid
- Hace 1 día

## Médico de familia
### Centro Sur
- Sevilla
- Hace 10 días

## Auxiliar
### Hospital Este
- Barcelona
- Hace 3 días
      `.trim(),
      html: `
<a href="/rc/clk?jk=abc123def456">job 1</a>
<a href="/rc/clk?jk=def456abc789">job 2</a>
<a href="/rc/clk?jk=ghi789jkl012">job 3</a>
      `.trim(),
    })

    const result = await runSearch({
      query: "enfermera",
      location: "sevilla",
      page: 1,
      format: "json",
      jobage: 7,
      limit: 1,
    })

    expect(result).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0].title).toBe("Enfermera/a")
    expect(parsed.meta).toEqual({
      count: 1,
      page: 1,
      query: "enfermera",
      location: "sevilla",
      jobage: 7,
    })
  })

  test("emits plain format", async () => {
    let stdout = ""
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write

    mockFetchSearchPage.mockResolvedValueOnce({
      markdown: `
## Enfermera/a
### Clínica Norte
- Madrid
- Hace 1 día
      `.trim(),
      html: `<a href="/rc/clk?jk=abc123def456">job</a>`,
    })

    const result = await runSearch({
      query: "enfermera",
      page: 1,
      format: "plain",
    })

    expect(result).toBe(0)
    expect(stdout).toContain("Enfermera/a")
    expect(stdout).toContain("Clínica Norte")
  })

  test("emits table format", async () => {
    let stdout = ""
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write

    mockFetchSearchPage.mockResolvedValueOnce({
      markdown: `
## Enfermera/a
### Clínica Norte
- Madrid
- Hace 1 día
      `.trim(),
      html: `<a href="/rc/clk?jk=abc123def456">job</a>`,
    })

    const result = await runSearch({
      query: "enfermera",
      page: 1,
      format: "table",
    })

    expect(result).toBe(0)
    expect(stdout).toContain("Enfermera/a")
  })

  test("returns SEARCH_FAILED and writes error on fetch failure", async () => {
    let stderr = ""
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += chunk.toString()
      return true
    }) as typeof process.stderr.write

    mockFetchSearchPage.mockRejectedValueOnce(new Error("network down"))

    const result = await runSearch({ query: "enfermera", page: 1, format: "json" })

    expect(result).toBe(1)
    const parsed = JSON.parse(stderr)
    expect(parsed.code).toBe("SEARCH_FAILED")
    expect(parsed.error).toContain("network down")
  })
})
