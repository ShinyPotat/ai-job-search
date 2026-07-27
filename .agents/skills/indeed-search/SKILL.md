---
name: indeed-search
description: >
  Search live job listings from Indeed España (es.indeed.com) for any
  city, province, or role. Uses web scraping via Defuddle — no API key
  or authentication required. The query keyword should include the
  location (e.g. "técnico laboratorio sevilla"). Trigger phrases: indeed,
  buscar en indeed, ofertas indeed, indeed sevilla, indeed barcelona,
  indeed madrid, "busca en indeed", empleo indeed.
allowed-tools: Bash(bun run .agents/skills/indeed-search/cli/src/cli.ts *)
context: fork
enabled: true
---

# Indeed Search Skill

Search live job listings from **Indeed España** (`es.indeed.com`). Works for
**any Spanish city or province** — no authentication, no API key, and **zero
runtime dependencies** beyond `bun` and `defuddle`.

> Indeed does not offer a public API for the Spanish site. This skill scrapes
> public search results pages using [Defuddle](https://github.com/defuddle/defuddle)
> to extract clean markdown. Because it relies on page structure, it may break if
> Indeed changes their markup.

## ⚠️ Personal use only

This scrapes Indeed's public job pages. Keep volume low and don't use it
commercially or for bulk data collection. Run at your own risk.

## When to use this skill

- Search for job openings in any Spanish city or province on Indeed España
- Filter by keyword (job title, role, skills, company name)
- Get the full description of a specific job listing by its `jk` hash

## Trigger phrases

The skill is activated by any of these phrases:

- `indeed`
- `buscar en indeed`
- `ofertas indeed`
- `indeed sevilla`
- `indeed barcelona`
- `indeed madrid`
- `busca en indeed`
- `empleo indeed`
- `trabajo indeed`
- `indeed jobs`
- `indeed españa`

## Commands

### Search job listings

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts search --query "<keywords>" [flags]
```

Key flags:

- `--query <text>` / `-q <text>` — **required.** Keyword search. **Tip:** include the city/province in the query (e.g. `"técnico laboratorio sevilla"`, `"enfermera barcelona"`) or use `--location`.
- `--location <city>` — append a city/province to the keyword query (server-side). Equivalent to adding it to `--query`.
- `--page <n>` — page number (1-indexed). Default 1. Page 2 starts at result 10.
- `--limit, -n <n>` — cap total results emitted (client-side).
- `--jobage <days>` — client-side filter: only show jobs posted within the last N days.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts detail <jk-hash|viewjob-url> [--format json|plain]
```

Pass a full Indeed job URL (e.g. `https://es.indeed.com/viewjob?jk=abc123def456`) or the bare `jk` hex hash from search results. The CLI resolves either to the job-detail endpoint and returns the full description, requirements, offer details, contract type, schedule, and salary if available.

## Usage examples

```bash
# Técnico de laboratorio jobs in Sevilla
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "técnico laboratorio" --location "sevilla" --format table --limit 10

# Enfermera jobs in Madrid posted in the last 7 days
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "enfermera madrid" --jobage 7 --format json

# Camarero jobs in Barcelona as plain text
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "camarero" --location "barcelona" --format plain --limit 5

# Full details for a specific job by jk hash
bun run .agents/skills/indeed-search/cli/src/cli.ts detail "abc123def456" --format plain

# Full details for a specific job by URL
bun run .agents/skills/indeed-search/cli/src/cli.ts detail "https://es.indeed.com/viewjob?jk=abc123def456" --format json
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing `jk` hashes to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is scraped from Indeed España's public search results pages — no credentials required.
- Location can be provided via `--query` (e.g. `"enfermera sevilla"`) or via `--location`.
- Job IDs use the `jk` hex hash format (e.g. `abc123def456`).
- **Defuddle** is used for HTML content extraction; install it globally (`npm install -g defuddle`) for best results.
- Rate limiting is handled with **6 retries** and exponential backoff (500 ms initial, up to 8 s) for transient errors. Permanent errors (403, 404) fail immediately.
- Searches are limited to `es.indeed.com` only.
- **Sponsored results are filtered out**; only organic `rc/clk` URLs are kept.
- Indeed may block automated requests; keep volume low (see the ToS note above).
- **Known limitation:** `--jobage` and `--limit` are client-side filters applied after search results are fetched. The total result count shown by Indeed may therefore be higher than the number of results emitted.

## 🔑 BrightData Web Unlocker (recommended)

Indeed España aggressively blocks automated scraping (403 Forbidden). The CLI supports **BrightData Web Unlocker** to bypass anti-bot protection.

### Setup

1. Create a free BrightData account at https://brightdata.com
2. Create a **Web Unlocker** zone in your dashboard
3. Set environment variables:

```bash
export BRIGHTDATA_API_KEY="your-api-key"
export BRIGHTDATA_ZONE="your-zone-name"
```

The free tier includes **5,000 requests/month** — more than enough for personal use. No charges unless you exceed the free quota.

### How it works

When BrightData is configured, the CLI routes all requests through BrightData's proxy network instead of scraping directly. BrightData handles CAPTCHAs, IP rotation, and browser fingerprinting automatically. Requests take 30–60 seconds as BrightData solves anti-bot challenges.

When BrightData is **not** configured, the CLI falls back to direct scraping, which fails immediately with a clear error if Indeed blocks the request.

### Limitations with BrightData

- **Date/salary/contract fields** may be empty in search results — BrightData's HTML renders them differently than direct scraping. Use the `detail` command on individual job URLs for full information.
- **30–60 second latency** per search (CAPTCHA solving + IP rotation).
- Requires a payment method on file (free tier is not charged).
