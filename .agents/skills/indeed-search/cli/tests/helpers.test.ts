import { describe, expect, test, jest, beforeEach, afterEach } from "bun:test"
import {
  SEARCH_URL,
  DETAIL_URL,
  RESULTS_PER_PAGE,
  RetryableError,
  withRetry,
  buildUrl,
  normalizeId,
  extractJkHashes,
  parseDateToDays,
  parseCardEntry,
  parseSearchResults,
  parseJobDetail,
  filterByAge,
  filterByLimit,
  formatOutput,
  type SearchOpts,
  type JobCard,
} from "../src/helpers.ts"

describe("constants", () => {
  test("SEARCH_URL points to Indeed Spain", () => {
    expect(SEARCH_URL).toBe("https://es.indeed.com/jobs")
  })

  test("DETAIL_URL points to Indeed Spain viewjob", () => {
    expect(DETAIL_URL).toBe("https://es.indeed.com/viewjob")
  })

  test("RESULTS_PER_PAGE is 10", () => {
    expect(RESULTS_PER_PAGE).toBe(10)
  })
})

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const fn = jest.fn().mockResolvedValueOnce("ok")
    const result = await withRetry(fn, "label")
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test("retries on RetryableError and succeeds", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new RetryableError("boom", 429))
      .mockResolvedValueOnce("recovered")
    const result = await withRetry(fn, "label", { maxRetries: 2, initialDelay: 1 })
    expect(result).toBe("recovered")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  test("throws original error after exhausting retries", async () => {
    const err = new RetryableError("server error", 503)
    const fn = jest.fn().mockRejectedValue(err)
    await expect(
      withRetry(fn, "label", { maxRetries: 2, initialDelay: 1 }),
    ).rejects.toThrow("server error")
    expect(fn).toHaveBeenCalledTimes(3)
  })

  test("does not retry non-retryable errors", async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error("bad request"))
    await expect(withRetry(fn, "label")).rejects.toThrow("bad request")
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe("buildUrl", () => {
  test("builds URL with query only", () => {
    const opts: SearchOpts = { query: "enfermera" }
    expect(buildUrl(opts)).toBe("https://es.indeed.com/jobs?q=enfermera")
  })

  test("includes location when provided", () => {
    const opts: SearchOpts = { query: "enfermera", location: "sevilla" }
    expect(buildUrl(opts)).toBe("https://es.indeed.com/jobs?q=enfermera&l=sevilla")
  })

  test("omits start on page 1", () => {
    const opts: SearchOpts = { query: "enfermera", page: 1 }
    expect(buildUrl(opts)).toBe("https://es.indeed.com/jobs?q=enfermera")
  })

  test("includes start=20 on page 3", () => {
    const opts: SearchOpts = { query: "enfermera", page: 3 }
    expect(buildUrl(opts)).toBe("https://es.indeed.com/jobs?q=enfermera&start=20")
  })

  test("URL-encodes query and location", () => {
    const opts: SearchOpts = { query: "data scientist", location: "la línea" }
    expect(buildUrl(opts)).toBe(
      "https://es.indeed.com/jobs?q=data+scientist&l=la+l%C3%ADnea",
    )
  })
})

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

describe("extractJkHashes", () => {
  test("extracts organic jk hashes and ignores sponsored", () => {
    const html = `
      <a href="/pagead/clk?jk=aaaaaaaaaaaaaaaa&...">sponsored</a>
      <a href="/rc/clk?jk=abc123def456&...">job 1</a>
      <a href="/rc/clk?jk=fed654cba321&...">job 2</a>
      <a href="/pagead/clk?jk=bbbbbbbbbbbbbbbb&...">sponsored</a>
    `
    expect(extractJkHashes(html)).toEqual(["abc123def456", "fed654cba321"])
  })

  test("returns empty array when no organic links", () => {
    const html = `<a href="/pagead/clk?jk=sponsored">sponsored</a>`
    expect(extractJkHashes(html)).toEqual([])
  })

  test("deduplicates repeated hashes", () => {
    const html = `
      <a href="/rc/clk?jk=abc123">one</a>
      <a href="/rc/clk?jk=abc123">two</a>
    `
    expect(extractJkHashes(html)).toEqual(["abc123"])
  })
})

describe("parseDateToDays", () => {
  test("parses days", () => {
    expect(parseDateToDays("Hace 2 días")).toBe(2)
    expect(parseDateToDays("hace 10 días")).toBe(10)
  })

  test("parses hours as fractional days", () => {
    expect(parseDateToDays("Hace 1 hora")).toBeCloseTo(1 / 24, 5)
    expect(parseDateToDays("Hace 12 horas")).toBeCloseTo(12 / 24, 5)
  })

  test("parses 'hoy' as zero", () => {
    expect(parseDateToDays("hoy")).toBe(0)
    expect(parseDateToDays("Hoy")).toBe(0)
  })

  test("parses 30+ days", () => {
    expect(parseDateToDays("Hace 30+ días")).toBe(30)
  })

  test("parses months as 30 days", () => {
    expect(parseDateToDays("hace 1 mes")).toBe(30)
    expect(parseDateToDays("Hace 3 meses")).toBe(90)
  })

  test("returns null for missing or unknown dates", () => {
    expect(parseDateToDays(null)).toBeNull()
    expect(parseDateToDays("Publicada de nuevo")).toBeNull()
  })
})

describe("parseCardEntry", () => {
  test("parses a complete card chunk", () => {
    const chunk = `
## Enfermera/a residencia
### Residencia Sevilla
- Sevilla, Sevilla provincia
- Hace 2 días
- Contrato indefinido
- Jornada completa
- Salario 20.000 € - 25.000 € bruto/año
Más detalles del puesto...
    `.trim()
    const card = parseCardEntry(chunk)
    expect(card).not.toBeNull()
    expect(card!.title).toBe("Enfermera/a residencia")
    expect(card!.company).toBe("Residencia Sevilla")
    expect(card!.location).toBe("Sevilla, Sevilla provincia")
    expect(card!.date).toBe("Hace 2 días")
    expect(card!.contract).toBe("indefinido")
    expect(card!.schedule).toBe("completa")
    expect(card!.salary).toBe("20.000 € - 25.000 € bruto/año")
  })

  test("null-defaults missing optional fields", () => {
    const chunk = "## Solo título\n"
    const card = parseCardEntry(chunk)
    expect(card).not.toBeNull()
    expect(card!.title).toBe("Solo título")
    expect(card!.company).toBeNull()
    expect(card!.location).toBeNull()
    expect(card!.date).toBeNull()
    expect(card!.contract).toBeNull()
    expect(card!.schedule).toBeNull()
    expect(card!.salary).toBeNull()
  })

  test("returns null when there is no title", () => {
    expect(parseCardEntry("solo texto sin título")).toBeNull()
  })
})

describe("parseSearchResults", () => {
  const html = `
    <a href="/rc/clk?jk=abc123def456">job 1</a>
    <a href="/pagead/clk?jk=aaaaaaaaaaaaaaaa">sponsored</a>
    <a href="/rc/clk?jk=def456abc789">job 2</a>
  `

  test("parses multiple organic cards and skips sponsored", () => {
    const markdown = `
## Enfermera/a
### Clínica Norte
- Madrid
- Hace 1 día

## Médico de familia
### Centro Sur
- Sevilla
- Hace 2 días

## Patrocinado
### Empresa X
- Barcelona
- Hace 3 días
    `.trim()
    const cards = parseSearchResults(markdown, html)
    expect(cards).toHaveLength(2)
    expect(cards[0].id).toBe("abc123def456")
    expect(cards[0].title).toBe("Enfermera/a")
    expect(cards[1].id).toBe("def456abc789")
    expect(cards[1].title).toBe("Médico de familia")
  })

  test("returns empty array when no cards match", () => {
    expect(parseSearchResults("no cards here", html)).toEqual([])
  })
})

describe("parseJobDetail", () => {
  test("parses full detail markdown", () => {
    const markdown = `
# Oferta de empleo
## Desarrollador web
### TechCorp
- Madrid, Madrid provincia
- Hace 5 días
- Contrato indefinido
- Jornada completa
- Salario 30.000 € - 40.000 € bruto/año

Descripción del puesto en detalle.
Más líneas.
    `.trim()
    const detail = parseJobDetail(markdown, "https://es.indeed.com/viewjob?jk=abc123def456")
    expect(detail.id).toBe("abc123def456")
    expect(detail.title).toBe("Desarrollador web")
    expect(detail.company).toBe("TechCorp")
    expect(detail.location).toBe("Madrid, Madrid provincia")
    expect(detail.date).toBe("Hace 5 días")
    expect(detail.contract).toBe("indefinido")
    expect(detail.schedule).toBe("completa")
    expect(detail.salary).toBe("30.000 € - 40.000 € bruto/año")
    expect(detail.description).toContain("Descripción del puesto")
    expect(detail.rawMarkdown).toBe(markdown)
  })

  test("null-defaults missing detail fields", () => {
    const markdown = "## Puesto sin datos\n"
    const detail = parseJobDetail(markdown, "https://es.indeed.com/viewjob?jk=nnn")
    expect(detail.title).toBe("Puesto sin datos")
    expect(detail.company).toBeNull()
    expect(detail.location).toBeNull()
    expect(detail.contract).toBeNull()
    expect(detail.schedule).toBeNull()
    expect(detail.salary).toBeNull()
    expect(detail.description).toBeNull()
  })
})

describe("filterByAge", () => {
  const cards: JobCard[] = [
    { id: "1", title: "A", company: null, location: null, date: "Hace 2 días", contract: null, schedule: null, salary: null, url: "" },
    { id: "2", title: "B", company: null, location: null, date: "Hace 10 días", contract: null, schedule: null, salary: null, url: "" },
    { id: "3", title: "C", company: null, location: null, date: null, contract: null, schedule: null, salary: null, url: "" },
  ]

  test("excludes cards older than threshold", () => {
    expect(filterByAge(cards, 7)).toHaveLength(2)
    expect(filterByAge(cards, 7).map((c) => c.id)).toEqual(["1", "3"])
  })

  test("keeps all cards when no jobage is given", () => {
    expect(filterByAge(cards, null)).toHaveLength(3)
  })
})

describe("filterByLimit", () => {
  const cards: JobCard[] = [
    { id: "1", title: "A", company: null, location: null, date: null, contract: null, schedule: null, salary: null, url: "" },
    { id: "2", title: "B", company: null, location: null, date: null, contract: null, schedule: null, salary: null, url: "" },
    { id: "3", title: "C", company: null, location: null, date: null, contract: null, schedule: null, salary: null, url: "" },
  ]

  test("caps results at limit", () => {
    expect(filterByLimit(cards, 2)).toHaveLength(2)
  })

  test("returns all when limit is null", () => {
    expect(filterByLimit(cards, null)).toHaveLength(3)
  })
})

describe("formatOutput", () => {
  const meta = { count: 2, page: 1, query: "enfermera" }
  const results: JobCard[] = [
    {
      id: "abc",
      title: "Enfermera/a",
      company: "Clínica",
      location: "Sevilla",
      date: "Hace 2 días",
      contract: null,
      schedule: null,
      salary: null,
      url: "https://es.indeed.com/viewjob?jk=abc",
    },
  ]

  test("formats json output", () => {
    const out = formatOutput(meta, results, "json")
    const parsed = JSON.parse(out)
    expect(parsed.meta).toEqual(meta)
    expect(parsed.results).toEqual(results)
  })

  test("formats plain output", () => {
    const out = formatOutput(meta, results, "plain")
    expect(out).toContain("Enfermera/a")
    expect(out).toContain("Clínica")
    expect(out).toContain("Sevilla")
  })

  test("formats table output", () => {
    const out = formatOutput(meta, results, "table")
    expect(out).toContain("Enfermera/a")
    expect(out).toContain("Clínica")
  })
})
