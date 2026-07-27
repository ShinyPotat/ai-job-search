import { afterEach, describe, expect, mock, test } from "bun:test"
import * as helpers from "../src/helpers"

mock.module("../src/helpers.js", () => ({
  ...helpers,
  fetchSearchPage: mock((url: string) =>
    Promise.resolve({
      markdown: `
- [![logo](https://example.com/logo.png)](https://company.infojobs.net/)
## Remote Engineer
### TechCorp
- Madrid
- Teletrabajo
- Hace 1d
Work from home.
- Contrato indefinido
- Jornada completa
- 30.000 € - 40.000 € Bruto/año

- [![logo](https://example.com/logo.png)](https://company.infojobs.net/)
## Onsite Engineer
### OldCorp
- Barcelona
- Presencial
- Hace 30d
Office based.
- Contrato indefinido
- Jornada completa
- 25.000 € - 35.000 € Bruto/año
`,
      html: "<html></html>",
    }),
  ),
}))

const searchModule = await import("../src/commands/search")
const { runSearch, buildUrl, filterByAge, filterByRemote } = searchModule
type SearchOpts = searchModule.SearchOpts

type JobCard = helpers.JobCard

const originalStdoutWrite = process.stdout.write

function makeCard(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: "of-i123",
    title: "Engineer",
    company: "Acme",
    location: "Madrid",
    remote: "Presencial",
    date: "Hace 2d",
    contract: "Indefinido",
    schedule: "Jornada completa",
    salary: "30.000 €",
    url: "https://www.infojobs.net/madrid/engineer/of-i123",
    ...overrides,
  }
}

afterEach(() => {
  process.stdout.write = originalStdoutWrite
})

describe("buildUrl", () => {
  test("appends location to keyword query param", () => {
    const url = buildUrl({ query: "camarero", page: 1, format: "json", location: "sevilla" })
    expect(url).toContain("keyword=camarero+sevilla")
  })

  test("leaves keyword unchanged when location is absent", () => {
    const url = buildUrl({ query: "camarero", page: 1, format: "json" })
    expect(url).toContain("keyword=camarero")
    expect(url).not.toContain("sevilla")
  })
})

describe("filterByAge", () => {
  test("keeps jobs within threshold", () => {
    const cards = [makeCard({ date: "Hace 1d" }), makeCard({ date: "Hace 3d" })]
    expect(filterByAge(cards, 7)).toHaveLength(2)
  })

  test("excludes jobs older than threshold", () => {
    const cards = [makeCard({ date: "Hace 1d" }), makeCard({ date: "Hace 10d" })]
    const result = filterByAge(cards, 7)
    expect(result).toHaveLength(1)
    expect(result[0].date).toBe("Hace 1d")
  })

  test("keeps cards with unparseable dates", () => {
    const cards = [makeCard({ date: null }), makeCard({ date: "Hace 3d" })]
    expect(filterByAge(cards, 7)).toHaveLength(2)
  })
})

describe("filterByRemote", () => {
  test("keeps only matching workplace type", () => {
    const cards = [
      makeCard({ remote: "Teletrabajo" }),
      makeCard({ remote: "Presencial" }),
      makeCard({ remote: "Híbrido" }),
    ]
    const result = filterByRemote(cards, "remote")
    expect(result).toHaveLength(1)
    expect(result[0].remote).toBe("Teletrabajo")
  })

  test("returns all cards when mode is empty", () => {
    const cards = [makeCard({ remote: "Presencial" }), makeCard({ remote: "Teletrabajo" })]
    expect(filterByRemote(cards, "")).toHaveLength(2)
  })
})

describe("runSearch", () => {
  test("applies client-side filters before output", async () => {
    let stdout = ""
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString()
      return true
    }) as typeof process.stdout.write

    const code = await runSearch({
      query: "engineer",
      page: 1,
      jobage: 7,
      remote: "remote",
      format: "json",
    } as SearchOpts)

    expect(code).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0].title).toBe("Remote Engineer")
  })
})
