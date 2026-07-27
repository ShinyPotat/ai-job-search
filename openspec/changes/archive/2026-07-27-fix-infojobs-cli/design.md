# Design: Fix InfoJobs CLI

## Technical Approach

Fix 3 blocking bugs (null metadata, broken detail, no retry), add feature parity with linkedin-search CLI (filter flags, test suite), and correct documentation. All changes are isolated to `.agents/skills/infojobs-search/` — no shared infrastructure affected. The approach follows existing patterns from the linkedin-search reference CLI.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| parseCardEntry fix | (a) Remove `break` and scan all lines, (b) Two-pass: metadata then description | (a) simpler, single pass; (b) more explicit but duplicates iteration | **(a)** — remove the early `break` at `helpers.ts:265`. The `- ` prefix reliably distinguishes metadata bullets from description prose. Contract/schedule/salary always appear as `- Contrato`, `- Jornada`, `- Salario` or salary-amount patterns. |
| Detail of-i IDs | (a) Full URL only, (b) Search-lookup resolver | (a) breaks search→detail flow; (b) adds one extra HTTP call but preserves UX | **(b)** — add `resolveJobUrl(hash)` in `helpers.ts` that fetches search page HTML, runs `extractJobUrls`, and matches by hash. Falls back to error if unresolved. |
| Retry wrapping | (a) Wrap defuddle shell calls, (b) Wrap only `fetch()` | (a) covers both code paths; (b) misses defuddle failures | **(a)** — port linkedin's `htmlFetch` retry loop (6 retries, exponential backoff + jitter, 429/5xx) to both `fetchSearchPage` and `defuddleFetch`. For defuddle shell commands, retry on non-zero exit. |
| Filter strategy | (a) Server-side URL params, (b) Client-side post-filtering | InfoJobs has no location/jobage/remote URL params (location is baked into keyword) | **Mixed** — `--location` appends to `keyword` param (server-side). `--jobage` and `--remote` are client-side filters on parsed cards. |

## Data Flow

```
Search flow:
  cli.ts (parse flags) → search.ts (buildUrl with --location appended to keyword)
    → helpers.ts fetchSearchPage(url) [with retry]
      → defuddle parse --md (markdown) + fetch (HTML)
    → parseSearchResults(markdown, html) → parseCardEntry per chunk
    → client-side filters: --jobage (date parse), --remote (workplace type)
    → render output

Detail flow:
  cli.ts → detail.ts normalizeId(input)
    → if of-i hash: resolveJobUrl(hash) [search-lookup helper]
    → defuddleFetch(url) [with retry]
    → parseJobDetail(markdown, url)
    → render output
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `cli/src/helpers.ts` | Modify | Fix `parseCardEntry` loop (remove break at L265, scan all `- ` lines). Add `withRetry()` wrapper. Add `resolveJobUrl(hash)`. Add `parseDateToDays()` and `matchesWorkplaceType()` filter helpers. |
| `cli/src/commands/detail.ts` | Modify | Replace `normalizeId` search-URL fallback with `resolveJobUrl(hash)` call. Wrap `defuddleFetch` with retry. |
| `cli/src/commands/search.ts` | Modify | Extend `SearchOpts` with `jobage`, `remote`, `location`. Append location to keyword in `buildUrl`. Add `filterByAge()` and `filterByRemote()` post-processing. |
| `cli/src/cli.ts` | Modify | Add `--jobage`, `--remote`, `--location` to flag parsing and `parseIntFlag` validation. Update HELP text. |
| `cli/tests/helpers.ts` | Create | `runCLI()` and `parseJSON()` — mirror linkedin pattern exactly. |
| `cli/tests/parsing.test.ts` | Create | Test `parseCardEntry` with description-before-metadata markdown. Test `parseJobDetail` edge cases. |
| `cli/tests/cli-flag-validation.test.ts` | Create | Test `--jobage`, `--remote`, `--location` NaN/type validation via `runCLI`. |
| `cli/tests/request-timeout.test.ts` | Create | Test `withRetry` exponential backoff: mock fetch to return 503 then 200 (recovery), mock 7x 429 (exhaustion), assert delay progression (~500ms doubling to 8000ms cap with jitter). |
| `cli/tests/search.test.ts` | Create | Mock `fetchSearchPage`, verify filter application and output format. |
| `SKILL.md` | Modify | Remove "Falls back to direct HTTP" (L89). Add limitation: of-i IDs resolved via search lookup. Document new flags. |

## Interfaces / Contracts

```typescript
// New helpers in helpers.ts

/** Retry wrapper — ports linkedin htmlFetch pattern (6 retries, exp backoff + jitter). */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T>

/** Resolve of-i hash to full job URL via search page HTML lookup. */
export async function resolveJobUrl(hash: string): Promise<string | null>

/** Parse "Hace 3h", "Hace 2d", "Hace un día" → number of days (float). */
export function parseDateToDays(dateStr: string | null): number | null

/** Check if card matches workplace type: "teletrabajo" | "hibrido" | "presencial". */
export function matchesWorkplaceType(card: JobCard, mode: string): boolean

// Extended SearchOpts
export interface SearchOpts {
  query: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
  jobage?: number    // NEW: filter jobs posted within N days
  remote?: string    // NEW: "teletrabajo" | "hibrido" | "presencial"
  location?: string  // NEW: appended to keyword query
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `parseCardEntry` with metadata after description text | Synthetic defuddle markdown fixtures with contract/schedule/salary after prose |
| Unit | `parseDateToDays` for "Hace 3h", "Hace 2d", "Hace un día" | Direct function calls with expected day values |
| Unit | `matchesWorkplaceType` for Teletrabajo/Híbrido/Presencial | Cards with known workplace strings |
| Integration | CLI flag validation (`--jobage foo`, `--remote`, `--location`) | `runCLI()` subprocess, assert exit codes and stderr JSON |
| Integration | `withRetry` backoff: recovery after 503, exhaustion after 7x 429, delay progression | Mock `fetch` with sequenced responses, assert call count and timing |
| Integration | `runSearch` with mocked `fetchSearchPage` | Mock global `$` and `fetch`, verify filter application |
| E2E | Live search (optional, gated) | Real defuddle call against InfoJobs, assert non-null metadata |

## Migration / Rollout

No migration required. CLI is stateless. Revert by reverting commits.

## Open Questions

- [ ] Should `resolveJobUrl` cache results within a session to avoid repeated lookups for the same hash?
- [ ] Should `--remote` accept English values (`remote`/`hybrid`/`onsite`) and map to Spanish, or only Spanish values?
