# Design: add-indeed-search

## Technical Approach

Follow the infojobs-search pattern: a Bun TypeScript CLI with Defuddle markdown for text extraction and raw HTML for URL/jk-hash extraction. Indeed.es renders server-side HTML, making Defuddle viable. The dual-fetch strategy (markdown + HTML in parallel) gives us clean text parsing from markdown and reliable jk hash extraction from raw HTML — where Defuddle's link transformation loses the jk parameter as a plain string.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Parse source | Raw HTML vs Defuddle markdown | **Markdown** | Proven in infojobs-search; simpler regex on clean text; Indeed renders server-side |
| jk hash extraction | Markdown links vs raw HTML | **Raw HTML** | Defuddle transforms `/rc/clk?jk=...` into markdown links, losing the jk as extractable text. HTML regex on `href` attributes is reliable |
| Sponsored filtering | Parse-time vs post-parse | **Parse-time** | Filter before building JobCard objects; avoids wasted work on sponsored entries |
| Fetch strategy | Single defuddle vs dual-fetch | **Dual-fetch** (defuddle + raw HTML in parallel) | Matches infojobs pattern; HTML needed for jk hashes that markdown can't preserve |
| Retry mechanism | Custom vs shared | **Copy infojobs `withRetry`** | Proven pattern, same constants (500ms→8s, 6 retries, jitter); no shared lib exists |

## Data Flow

```
CLI (cli.ts)
  │
  ├─ search ──→ runSearch (commands/search.ts)
  │               │
  │               ├─ buildUrl(opts) → es.indeed.com/jobs?q=...&l=...&start=...
  │               ├─ fetchSearchPage(url) → { markdown, html }
  │               │     ├─ defuddle parse --md (markdown)  ─┐ parallel
  │               │     └─ fetch(url) (raw HTML)           ─┘
  │               ├─ parseSearchResults(markdown, html)
  │               │     ├─ extractJkHashes(html) → Map<cardIndex, jk>
  │               │     ├─ split markdown into card chunks
  │               │     ├─ filter sponsored (pagead/clk URLs in html)
  │               │     └─ parseCardEntry(chunk) → JobCard per chunk
  │               ├─ filterByAge / filterByLimit
  │               └─ format output (json|table|plain)
  │
  └─ detail ──→ runDetail (commands/detail.ts)
                  │
                  ├─ normalizeId(input) → jk hash
                  ├─ defuddleFetch(viewjob?jk=...)
                  └─ parseJobDetail(markdown) → JobDetail
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `.agents/skills/indeed-search/SKILL.md` | Create | Skill frontmatter, usage docs, trigger phrases |
| `.agents/skills/indeed-search/cli/package.json` | Create | Bun project config (mirrors infojobs) |
| `.agents/skills/indeed-search/cli/tsconfig.json` | Create | TypeScript config (mirrors infojobs) |
| `.agents/skills/indeed-search/cli/src/cli.ts` | Create | Entry point: flag parsing, subcommand dispatch |
| `.agents/skills/indeed-search/cli/src/helpers.ts` | Create | Types, fetch, parse, retry, URL building utilities |
| `.agents/skills/indeed-search/cli/src/commands/search.ts` | Create | Search command: buildUrl, runSearch, filters, formatting |
| `.agents/skills/indeed-search/cli/src/commands/detail.ts` | Create | Detail command: normalizeId, runDetail |
| `.agents/skills/indeed-search/cli/tests/parsing.test.ts` | Create | Unit tests for parse functions |
| `.agents/skills/indeed-search/cli/tests/search.test.ts` | Create | Integration tests with mocked fetch |
| `.agents/skills/indeed-search/cli/tests/request-timeout.test.ts` | Create | Retry/backoff behavior tests |
| `.agents/skills/indeed-search/cli/tests/cli-flag-validation.test.ts` | Create | CLI flag validation tests |
| `.claude/skills/job-scraper/SKILL.md` | None | No change needed — `/scrape` auto-discovers via SKILL.md glob |

## Interfaces / Contracts

```typescript
// helpers.ts — core types

interface JobCard {
  id: string           // jk hex hash (e.g. "a1b2c3d4e5f6")
  title: string
  company: string | null
  location: string | null
  date: string | null   // "Hace 2 días", "hoy", etc.
  url: string           // https://es.indeed.com/viewjob?jk=<hash>
}

interface JobDetail extends JobCard {
  description: string | null
  contract: string | null
  schedule: string | null
  salary: string | null
  rawMarkdown: string
}

interface SearchMeta {
  count: number
  page: number
  query: string
  location?: string
  jobage?: number
}

// Search URL construction
function buildUrl(opts: SearchOpts): string
// → https://es.indeed.com/jobs?q=<query>&l=<location>&start=<offset>
// Page 1 omits `start`. Page N → start = (N-1) * 10

// Detail URL normalization
function normalizeId(input: string): string | null
// Accepts: bare jk hash, full viewjob URL, or URL with extra params
// Returns: jk hex hash string, or null if unparseable
```

## Parsing Strategy

**Card boundaries**: Indeed's Defuddle markdown renders each job card as a block starting with a heading pattern. Split on `\n## ` or the card container pattern observed in Defuddle output. Each card chunk is parsed independently — one malformed card cannot break others.

**Field extraction from markdown**:
- Title: first `## ` heading in chunk
- Company: first `### ` heading after title
- Location: first `- ` bullet matching a city pattern (uppercase start, <60 chars)
- Date: bullet matching `/Hace \d+ (día|días|hora|horas|mes)/i`

**jk hash extraction from raw HTML**:
```
// Organic links: href="/rc/clk?jk=<hex>&..."
// Sponsored links: href="/pagead/clk..."  ← filtered out
const organicRe = /href="\/rc\/clk\?jk=([a-f0-9]+)[^"]*"/g
const sponsoredRe = /href="\/pagead\/clk[^"]*"/g
```

**Sponsored filtering at parse-time**: Before building a JobCard, check if the corresponding URL region in the HTML contains `pagead/clk`. If so, skip the entire card chunk. This is done by correlating card position with URL position in the HTML.

## Retry/Backoff

Copied from infojobs-search `withRetry`:
- **Initial delay**: 500ms
- **Max delay**: 8000ms (capped via `Math.min`)
- **Max retries**: 6 (7 total attempts)
- **Jitter**: 0–500ms random per attempt
- **Trigger**: `RetryableError` thrown on HTTP 429, 5xx, or defuddle failure
- **Non-retryable**: 4xx (except 429), parse errors → immediate throw

## Error Handling Flow

```
fetch (429/5xx) → RetryableError → withRetry retries
fetch (4xx)     → Error → immediate throw → runSearch catch → stderr JSON, exit 1
defuddle fail   → RetryableError → withRetry retries
parse (0 cards) → empty results[] → exit 0 (not an error)
detail (<100 chars) → NOT_FOUND → stderr JSON, exit 1
cli (bad flags) → NO_QUERY/NO_ID/BAD_ARG → stderr JSON, exit 1
```

All errors: `{"error":"...","code":"..."}` on stderr, exit code 1.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `parseCardEntry`, `parseSearchResults`, `parseJobDetail`, `parseDateToDays`, `extractJkHashes`, `isSponsored` | Pure functions with markdown/HTML fixtures |
| Unit | `buildUrl`, `normalizeId` | URL construction assertions |
| Unit | `filterByAge`, `filterByLimit` | Card arrays with date overrides |
| Integration | `runSearch` end-to-end | `mock.module` on helpers (fetchSearchPage) like infojobs |
| Integration | Retry/backoff | Mock fetch returning 429 then 200; verify recovery |
| CLI | Flag validation | Spawn `bun run cli.ts` with bad flags, assert stderr + exit code |

Network isolation: all tests mock `fetchSearchPage`/`defuddleFetch` via `mock.module`. No real HTTP calls in tests.

## Migration / Rollout

No migration required. New isolated skill directory. `/scrape` auto-discovers it via the `.agents/skills/*/SKILL.md` glob — no scraper code changes needed.

## Open Questions

- [ ] Exact Defuddle markdown structure for Indeed.es search results needs live verification (card boundary pattern may differ from infojobs' `- [![` pattern). Implement with a configurable split regex and test against a saved fixture.
- [ ] Indeed may serve different HTML to different User-Agents — the mobile UA used by infojobs may or may not be optimal for Indeed. Test both mobile and desktop UAs during implementation.
