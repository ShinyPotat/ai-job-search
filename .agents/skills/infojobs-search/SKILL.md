---
name: infojobs-search
version: 1.0.0
description: >
  Search live job listings from InfoJobs (Spain's largest job portal) for any
  city, province, or role. Uses web scraping via Defuddle — no API key or
  authentication required. The query keyword should include the location
  (e.g. "camarero sevilla", "técnico laboratorio madrid"). Trigger phrases:
  infojobs, buscar en infojobs, ofertas infojobs, infojobs sevilla, infojobs
  barcelona, infojobs madrid, "busca en infojobs", empleo infojobs.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/infojobs-search/cli/src/cli.ts *)
---

# InfoJobs Search Skill

Search live job listings from InfoJobs, Spain's largest job portal. Works for
**any Spanish city or province** — no authentication, no API key, and **zero
runtime dependencies** beyond `bun` and `defuddle`.

> InfoJobs doesn't offer a public API. This skill scrapes the public search
> results pages using [Defuddle](https://github.com/defuddle/defuddle) to
> extract clean markdown. Because it relies on page structure, it may break
> if InfoJobs changes their markup.

## ⚠️ Personal use only

This scrapes InfoJobs' public job pages. Keep volume low and don't use it
commercially or for bulk data collection. Run at your own risk.

## When to use this skill

- Search for job openings in any Spanish city or province
- Filter by keyword (job title, role, skills, company name)
- Get the full description of a specific job listing

## Commands

### Search job listings

```bash
bun run .agents/skills/infojobs-search/cli/src/cli.ts search --query "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — **required.** Keyword search. **Tip:** include the city/province in the query (e.g. `"camarero sevilla"`, `"técnico laboratorio barcelona"`) or use `--location`.
- `--location <city>` — append a city/province to the keyword query (server-side). Equivalent to adding it to `--query`.
- `--page <n>` — page number (1-indexed). Default 1.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--jobage <days>` — client-side filter: only show jobs posted within the last N days.
- `--remote <mode>` — client-side filter: `remote` (Teletrabajo), `hybrid` (Híbrido), `onsite` (Presencial). Spanish values (`teletrabajo`, `hibrido`, `presencial`) are also accepted.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/infojobs-search/cli/src/cli.ts detail <url|id> [--format json|plain]
```

Pass a full InfoJobs job URL (e.g. `https://www.infojobs.net/sevilla/tecnico-calibracion/of-i64b301a63c4aa49ca23fc625897482`) or the `of-i<hash>` ID from search results. The CLI resolves `of-i<hash>` IDs to the job-detail endpoint. Returns full description, requirements, offer details, contract type, and schedule info.

## Usage examples

```bash
# Camarero jobs in Sevilla
bun run .agents/skills/infojobs-search/cli/src/cli.ts search -q "camarero" --location "sevilla" --format table --limit 10

# Onsite-only camarero jobs in Sevilla
bun run .agents/skills/infojobs-search/cli/src/cli.ts search -q "camarero sevilla" --remote onsite --format table

# Lab technician jobs near Barcelona posted in the last 7 days
bun run .agents/skills/infojobs-search/cli/src/cli.ts search -q "técnico laboratorio barcelona" --jobage 7 --format json

# Full details for a specific job
bun run .agents/skills/infojobs-search/cli/src/cli.ts detail "of-i64b301a63c4aa49ca23fc625897482" --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is scraped from InfoJobs' public search results pages — no credentials required.
- Location can be provided via `--query` (e.g. `"enfermera sevilla"`) or via `--location`.
- Job IDs use the `of-i<hash>` format (e.g. `of-i64b301a63c4aa49ca23fc625897482`).
- InfoJobs may block automated requests; keep volume low (see ToS note above).
- Defuddle must be installed (`npm install -g defuddle`) for best results; the CLI does not fall back to direct HTTP if it is unavailable.
- **Known limitation:** `--jobage` and `--remote` are client-side filters applied after search results are fetched. The total result count shown by InfoJobs may therefore be higher than the number of results emitted.
