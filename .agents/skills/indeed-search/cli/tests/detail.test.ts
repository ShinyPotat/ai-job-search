import { afterEach, describe, expect, mock, test } from "bun:test"
import * as helpers from "../src/helpers.ts"

const mockDefuddleFetch = mock((url: string) =>
  Promise.resolve(`
# Oferta de empleo
## Desarrollador web
### TechCorp
- Madrid, Madrid provincia
- Hace 5 días
- Contrato indefinido
- Jornada completa
- Salario 30.000 € - 40.000 € bruto/año

Descripción del puesto en detalle.
  `.trim()),
)

mock.module("../src/helpers.js", () => ({
  ...helpers,
  defuddleFetch: mockDefuddleFetch,
}))

const detailModule = await import("../src/commands/detail.ts")
const { runDetail, normalizeId } = detailModule

describe("normalizeId", () => {
  test("returns bare jk hash", () => {
    expect(normalizeId("abc123def456")).toBe("abc123def456")
  })

  test("extracts hash from viewjob URL", () => {
    expect(normalizeId("https://es.indeed.com/viewjob?jk=abc123def456")).toBe(
      "abc123def456",
    )
  })

  test("extracts hash from URL with extra params", () => {
    expect(
      normalizeId("https://es.indeed.com/viewjob?jk=abc123def456&from=serp&vjs=3"),
    ).toBe("abc123def456")
  })

  test("returns null for invalid input", () => {
    expect(normalizeId("")).toBeNull()
    expect(normalizeId("https://example.com")).toBeNull()
  })
})

describe("runDetail", () => {
  const originalStdoutWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    mockDefuddleFetch.mockClear()
  })

  test("emits json detail and returns 0", async () => {
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

    const result = await runDetail({
      id: "abc123def456",
      format: "json",
    })

    expect(result).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.id).toBe("abc123def456")
    expect(parsed.title).toBe("Desarrollador web")
    expect(parsed.url).toBe("https://es.indeed.com/viewjob?jk=abc123def456")
  })

  test("emits plain detail", async () => {
    mockDefuddleFetch.mockResolvedValueOnce(`
## Desarrollador web
### TechCorp España
- Madrid, Madrid provincia
- Hace 5 días
- Contrato indefinido
- Jornada completa

Descripción detallada del puesto de desarrollador web en Madrid.
Esta oferta incluye beneficios y requisitos adicionales.
    `.trim())

    let stdout = ""
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write

    const result = await runDetail({ id: "abc123def456", format: "plain" })

    expect(result).toBe(0)
    expect(stdout).toContain("Desarrollador web")
    expect(stdout).toContain("Descripción detallada del puesto")
  })

  test("returns NOT_FOUND when content is too short", async () => {
    mockDefuddleFetch.mockResolvedValueOnce("short")

    let stderr = ""
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += chunk.toString()
      return true
    }) as typeof process.stderr.write

    const result = await runDetail({ id: "abc123def456", format: "json" })

    expect(result).toBe(1)
    const parsed = JSON.parse(stderr)
    expect(parsed.code).toBe("NOT_FOUND")
  })

  test("returns DETAIL_FAILED on fetch error", async () => {
    mockDefuddleFetch.mockRejectedValueOnce(new Error("defuddle failed"))

    let stderr = ""
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += chunk.toString()
      return true
    }) as typeof process.stderr.write

    const result = await runDetail({ id: "abc123def456", format: "json" })

    expect(result).toBe(1)
    const parsed = JSON.parse(stderr)
    expect(parsed.code).toBe("DETAIL_FAILED")
    expect(parsed.error).toContain("defuddle failed")
  })
})
