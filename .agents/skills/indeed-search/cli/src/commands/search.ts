import {
  fetchSearchPage,
  parseSearchResults,
  filterByAge,
  filterByLimit,
  formatOutput,
  writeError,
  buildUrl as helpersBuildUrl,
  type SearchOpts,
  type SearchMeta,
} from "../helpers.js"

export interface RunSearchOpts {
  query: string
  page: number
  location?: string
  limit?: number
  jobage?: number
  format: "json" | "table" | "plain"
}

/** Build an Indeed Spain search URL from options. */
export function buildUrl(opts: SearchOpts): string {
  return helpersBuildUrl(opts)
}

export async function runSearch(opts: RunSearchOpts): Promise<number> {
  try {
    const url = buildUrl({
      query: opts.query,
      location: opts.location,
      page: opts.page,
    })
    const { markdown, html } = await fetchSearchPage(url)
    let cards = parseSearchResults(markdown, html)
    cards = filterByAge(cards, opts.jobage ?? null)
    cards = filterByLimit(cards, opts.limit ?? null)

    const meta: SearchMeta = {
      count: cards.length,
      page: opts.page,
      query: opts.query,
      ...(opts.location !== undefined && { location: opts.location }),
      ...(opts.jobage !== undefined && { jobage: opts.jobage }),
    }

    process.stdout.write(formatOutput(meta, cards, opts.format) + "\n")
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
