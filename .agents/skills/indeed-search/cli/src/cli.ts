#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Indeed Spain via web scraping.
// Uses `defuddle` to extract clean markdown from search/detail pages.
// No API key, no authentication. Personal use only.
//
// This reads Indeed Spain's public job pages; keep volume low and do not use
// commercially or for bulk data collection. Run at your own risk.

import { parseFlags } from "./flags.js"
import { runSearch, type RunSearchOpts } from "./commands/search.js"
import { runDetail, type RunDetailOpts } from "./commands/detail.js"

const HELP = `indeed-search-cli — search jobs on Indeed Spain

USAGE
  bun run src/cli.ts search --query "<keywords>" [flags]
  bun run src/cli.ts detail <jk-hash|viewjob-url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Keywords (job title, role, skills). REQUIRED.
  --location <city>      City or province for server-side filtering.
  --page <n>             1-indexed page. Default 1.
  --limit, -n <n>        Cap results emitted (client-side).
  --jobage <days>        Client-side filter: only show jobs posted within N days.
  --format <fmt>         json (default) | table | plain.

DETAIL
  Pass a jk hash (e.g. abc123def456) or a full viewjob URL.

EXAMPLES
  bun run src/cli.ts search -q "enfermera" --location "sevilla" --format table --limit 10
  bun run src/cli.ts detail "https://es.indeed.com/viewjob?jk=abc123def456" --format plain

Personal use only — scrapes Indeed Spain public pages; keep volume low.
`

export async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv)
  const cmd = flags._[0]

  if (!cmd || flags.help === true || flags.h === true) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd === "search") {
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      process.stderr.write(
        JSON.stringify({
          error:
            "the --query/-q flag is required (e.g. -q 'enfermera sevilla')",
          code: "NO_QUERY",
        }) + "\n",
      )
      return 1
    }

    const fmt = (flags.format as string) || "json"

    const parseIntFlag = (
      name: string,
      raw: string | boolean | string[] | undefined,
    ): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(
          JSON.stringify({
            error: `--${name} must be a number, got "${raw}"`,
            code: "BAD_ARG",
          }) + "\n",
        )
        return null
      }
      return val
    }

    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      flags.page = String(v)
    }
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      flags.limit = String(v)
    }
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      flags.jobage = String(v)
    }

    const opts: RunSearchOpts = {
      query,
      location: typeof flags.location === "string" ? flags.location : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : undefined,
      format: (["json", "table", "plain"].includes(fmt)
        ? fmt
        : "json") as RunSearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = flags._[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({
          error: "detail requires a <jk-hash|viewjob-url>",
          code: "NO_ID",
        }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: RunDetailOpts = {
      id,
      format: (fmt === "plain" ? "plain" : "json") as RunDetailOpts["format"],
    }
    return runDetail(opts)
  }

  process.stderr.write(
    JSON.stringify({
      error: `Unknown command "${cmd}"`,
      code: "BAD_CMD",
    }) + "\n",
  )
  return 1
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(
        JSON.stringify({
          error: e instanceof Error ? e.message : String(e),
          code: "INTERNAL_ERROR",
        }) + "\n",
      )
      process.exit(1)
    })
}
