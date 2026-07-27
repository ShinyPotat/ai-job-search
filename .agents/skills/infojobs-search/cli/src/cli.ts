#!/usr/bin/env bun
// Self-contained CLI for searching jobs on InfoJobs (Spain) via web scraping.
// Uses `defuddle` to extract clean markdown from search/detail pages.
// No API key, no authentication. Personal use only.
//
// This reads InfoJobs' public job pages; keep volume low and do not use
// commercially or for bulk data collection. Run at your own risk.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `infojobs-cli — search jobs on InfoJobs (Spain)

USAGE
  bun run src/cli.ts search --query "<keywords>" [flags]
  bun run src/cli.ts detail <url|id> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Keywords (job title, role, skills). REQUIRED.
  --location <city>      Append city/province to the keyword query (server-side),
                          e.g. -q "camarero" --location "sevilla" searches "camarero sevilla".
  --page <n>             1-indexed page. Default 1.
  --limit, -n <n>        Cap results emitted (client-side).
  --jobage <days>        Client-side filter: only show jobs posted within N days.
  --remote <mode>        Client-side filter: remote | hybrid | onsite.
                          Maps to Spanish workplace types: Teletrabajo | Híbrido | Presencial.
  --format <fmt>         json (default) | table | plain.

DETAIL
  Pass a full InfoJobs URL (e.g. https://www.infojobs.net/.../of-i<hash>)
  or the of-i<hash> ID from search results.

EXAMPLES
  bun run src/cli.ts search -q "camarero" --location "sevilla" --format table --limit 10
  bun run src/cli.ts search -q "camarero sevilla" --remote onsite --format table
  bun run src/cli.ts search -q "técnico laboratorio barcelona" --format json
  bun run src/cli.ts detail "https://www.infojobs.net/sevilla/tecnico-calibracion/of-i64b30..." --format plain

Personal use only — scrapes InfoJobs public pages; keep volume low.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd === "search") {
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      process.stderr.write(
        JSON.stringify({
          error:
            "the --query/-q flag is required (e.g. -q 'camarero sevilla')",
          code: "NO_QUERY",
        }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"

    const parseIntFlag = (
      name: string,
      raw: string | boolean | string[],
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

    const VALID_REMOTE_MODES = ["remote", "hybrid", "onsite", "teletrabajo", "hibrido", "híbrido", "presencial"]
    if (flags.remote !== undefined) {
      const remote = String(flags.remote).toLowerCase().trim()
      if (!VALID_REMOTE_MODES.includes(remote)) {
        process.stderr.write(
          JSON.stringify({
            error: `--remote must be one of: remote, hybrid, onsite, teletrabajo, hibrido, presencial. Got "${flags.remote}"`,
            code: "BAD_ARG",
          }) + "\n",
        )
        return 1
      }
    }

    const opts: SearchOpts = {
      query,
      location: typeof flags.location === "string" ? flags.location : undefined,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? parseInt(flags.limit as string, 10) : undefined,
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : undefined,
      remote: typeof flags.remote === "string" ? flags.remote : undefined,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(
        JSON.stringify({
          error: "detail requires a <url|id>",
          code: "NO_ID",
        }) + "\n",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
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

main()
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
