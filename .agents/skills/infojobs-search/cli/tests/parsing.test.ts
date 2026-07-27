import { describe, test, expect } from "bun:test"
import {
  parseCardEntry,
  parseDateToDays,
  matchesWorkplaceType,
  parseSearchResults,
  parseJobDetail,
  type JobCard,
} from "../src/helpers"

function makeCard(remote: string): JobCard {
  return {
    id: "of-i123",
    title: "Test",
    company: "Acme",
    location: "Madrid",
    date: "Hace 2d",
    contract: "Indefinido",
    schedule: "Jornada completa",
    salary: "25.000 €",
    url: "https://www.infojobs.net/madrid/test/of-i123",
    remote,
  } as JobCard
}

const DESCRIPTION_BEFORE_METADATA = `
- [![logo](https://example.com/logo.png)](https://company.infojobs.net/)
## Camarero/a de Sala
### Restaurante Sevilla
- Sevilla
- Presencial
- Hace 2d
Buscamos camarero/a con experiencia en sala y atención al cliente.
- Contrato indefinido
- Jornada completa
- 20.000 € - 25.000 € Bruto/año
`

describe("parseCardEntry", () => {
  test("extracts metadata after description text", () => {
    const card = parseCardEntry(DESCRIPTION_BEFORE_METADATA)
    expect(card).not.toBeNull()
    expect(card!.remote).toBe("Presencial")
    expect(card!.contract).toBe("indefinido")
    expect(card!.schedule).toBe("completa")
    expect(card!.salary).toBe("20.000 € - 25.000 € Bruto/año")
  })

  test("returns null when metadata is absent", () => {
    const markdown = `- [![logo](https://example.com/logo.png)](https://company.infojobs.net/)
## Test Title
### Test Company
- Madrid
- Hace 1h
Only a description here.
`
    const card = parseCardEntry(markdown)
    expect(card).not.toBeNull()
    expect(card!.contract).toBeNull()
    expect(card!.schedule).toBeNull()
    expect(card!.salary).toBeNull()
  })
})

describe("parseSearchResults", () => {
  test("finds contract and salary after description across cards", () => {
    const cards = parseSearchResults(DESCRIPTION_BEFORE_METADATA)
    expect(cards).toHaveLength(1)
    expect(cards[0].contract).toBe("indefinido")
    expect(cards[0].schedule).toBe("completa")
    expect(cards[0].salary).toBe("20.000 € - 25.000 € Bruto/año")
  })
})

describe("parseDateToDays", () => {
  test("parses hours into fractional days", () => {
    expect(parseDateToDays("Hace 3h")).toBe(0.125)
  })

  test("parses days", () => {
    expect(parseDateToDays("Hace 2d")).toBe(2)
  })

  test("parses 'un día' as one day", () => {
    expect(parseDateToDays("Hace un día")).toBe(1)
  })

  test("returns null for unknown strings", () => {
    expect(parseDateToDays("Publicada hoy")).toBeNull()
  })

  test("returns null for null input", () => {
    expect(parseDateToDays(null)).toBeNull()
  })
})

describe("matchesWorkplaceType", () => {
  test("matches teletrabajo against remote", () => {
    expect(matchesWorkplaceType(makeCard("Teletrabajo"), "remote")).toBe(true)
  })

  test("matches híbrido against hybrid", () => {
    expect(matchesWorkplaceType(makeCard("Híbrido"), "hybrid")).toBe(true)
  })

  test("matches presencial against onsite", () => {
    expect(matchesWorkplaceType(makeCard("Presencial"), "onsite")).toBe(true)
  })

  test("matches spanish teletrabajo input", () => {
    expect(matchesWorkplaceType(makeCard("Teletrabajo"), "teletrabajo")).toBe(true)
  })

  test("rejects mismatching workplace", () => {
    expect(matchesWorkplaceType(makeCard("Presencial"), "remote")).toBe(false)
  })

  test("is false when workplace metadata is missing", () => {
    expect(matchesWorkplaceType(makeCard(""), "onsite")).toBe(false)
  })
})

describe("parseJobDetail", () => {
  test("preserves full description with nested sections", () => {
    const markdown = `## Ingeniero Software
### TechCorp
- Madrid
- Presencial
- Hace 1d

Descripción del puesto.

Requisitos
- 5 años experiencia
- Inglés

Qué ofrecemos
- Horario flexible
- Salario 30.000 € - 40.000 € Bruto/año
`
    const job = parseJobDetail(markdown, "https://www.infojobs.net/madrid/ingeniero/of-iabc")
    expect(job.description).toContain("Descripción del puesto")
    expect(job.requirements).toContain("5 años experiencia")
    expect(job.offer).toContain("Horario flexible")
  })
})
