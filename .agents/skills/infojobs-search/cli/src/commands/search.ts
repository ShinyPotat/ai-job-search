import {
  SEARCH_URL,
  fetchSearchPage,
  parseSearchResults,
  parseDateToDays,
  matchesWorkplaceType,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
  jobage?: number
  remote?: string
  location?: string
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  const keyword = opts.location ? `${opts.query} ${opts.location}`.trim() : opts.query
  params.set("keyword", keyword)
  if (opts.page > 1) {
    params.set("page", String(opts.page))
  }
  return `${SEARCH_URL}?${params.toString()}`
}

export function filterByAge(cards: JobCard[], days: number | undefined): JobCard[] {
  if (days === undefined) return cards
  return cards.filter((c) => {
    const d = parseDateToDays(c.date)
    return d === null || d <= days
  })
}

export function filterByRemote(cards: JobCard[], mode: string | undefined): JobCard[] {
  if (!mode) return cards
  return cards.filter((c) => matchesWorkplaceType(c, mode))
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results found."

  const rows = cards.map((c) => {
    const id = (c.id || "—").slice(0, 32).padEnd(32)
    const title = (c.title || "—").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 24).padEnd(24)
    const date = c.date || "—"
    return `${id} ${title} ${company} ${loc} ${date}`
  })

  const header =
    "ID".padEnd(32) +
    " " +
    "TITLE".padEnd(42) +
    " " +
    "COMPANY".padEnd(26) +
    " " +
    "LOCATION".padEnd(24) +
    " DATE"

  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const url = buildUrl(opts)
    const { markdown, html } = await fetchSearchPage(url)
    let cards = parseSearchResults(markdown, html)
    cards = filterByAge(cards, opts.jobage)
    cards = filterByRemote(cards, opts.remote)

    if (opts.limit !== undefined && opts.limit >= 0) {
      cards = cards.slice(0, opts.limit)
    }

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  contract: ${c.contract || "—"}\n  schedule: ${c.schedule || "—"}\n  salary: ${c.salary || "—"}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: cards.length,
              page: opts.page,
              query: opts.query,
              location: opts.location,
              jobage: opts.jobage,
              remote: opts.remote,
            },
            results: cards,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
