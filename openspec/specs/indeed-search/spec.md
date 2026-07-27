# indeed-search Specification

## Purpose

Indeed.es portal-search skill: search listings, fetch details, filter sponsored results, CLI interface via Defuddle scraping.

## Requirements

### Requirement: Search

The system MUST accept `--query` (required) and `--location` (optional), build `https://es.indeed.com/jobs?q=<query>&l=<location>&start=<offset>`, fetch via Defuddle, and emit job cards.

| Field | Source |
|-------|--------|
| `id` | `jk` hex hash from organic URL |
| `title` | Job title heading |
| `company` | Company name |
| `location` | City/region |
| `date` | Relative date string |
| `url` | `viewjob?jk=<hash>` |

`--page <n>` (1-indexed) maps to `start = (page-1)*10`. Page 1 omits `start`.

#### Scenario: Search with location

- GIVEN `--query "enfermera" --location "sevilla"`
- WHEN fetched and parsed
- THEN URL has `q=enfermera&l=sevilla`, results contain cards

#### Scenario: Pagination

- GIVEN `--page 3`
- WHEN URL built
- THEN `start=20`

#### Scenario: Empty results

- GIVEN no matching jobs
- WHEN parsed
- THEN `results` is `[]`, exit `0`

### Requirement: Sponsored Filtering

The system MUST exclude URLs containing `pagead/clk` and retain `rc/clk` or `viewjob?jk=` URLs.

#### Scenario: Mixed page

- GIVEN sponsored and organic cards on one page
- WHEN parsed
- THEN only organic cards in output

### Requirement: Output Formats

`--format json|table|plain` (default `json`). JSON: `{"meta":{count,page,query},"results":[...]}`. Table: aligned columns. Plain: one block per card.

#### Scenario: JSON default

- GIVEN no `--format` flag
- WHEN emitted
- THEN valid JSON with `meta` and `results`

### Requirement: Client-side Filters

`--jobage <days>` excludes cards older than N days. `--limit <n>` caps emitted results.

#### Scenario: Jobage filter

- GIVEN `--jobage 7` and card dated "Hace 10 días"
- WHEN filtered
- THEN card excluded

#### Scenario: Limit

- GIVEN `--limit 5` with 12 cards
- WHEN emitted
- THEN 5 cards returned

### Requirement: Job Detail

Accept `jk` hex hash or full `viewjob?jk=...` URL. Fetch `https://es.indeed.com/viewjob?jk=<hash>` via Defuddle. Extract title, company, location, contract, schedule, salary, description.

#### Scenario: By hash

- GIVEN `detail abc123def456`
- WHEN normalized
- THEN fetches `viewjob?jk=abc123def456`

#### Scenario: By URL

- GIVEN `detail "https://es.indeed.com/viewjob?jk=abc123&..."`
- WHEN normalized
- THEN extracts `jk=abc123`

#### Scenario: Not found

- GIVEN <100 chars of markdown returned
- WHEN parsed
- THEN `{"error":"...","code":"NOT_FOUND"}` on stderr, exit `1`

### Requirement: CLI Dispatch and Errors

Dispatch `search`/`detail` subcommands. Validate flags. JSON errors on stderr, exit `1`.

| Code | Trigger |
|------|---------|
| `NO_QUERY` | `search` without `--query` |
| `NO_ID` | `detail` without arg |
| `BAD_ARG` | Non-numeric `--page`/`--limit`/`--jobage` |
| `BAD_CMD` | Unknown subcommand |
| `SEARCH_FAILED` | Search failure |
| `DETAIL_FAILED` | Detail failure |
| `NOT_FOUND` | Insufficient detail content |

#### Scenario: Missing query

- GIVEN `search` without `--query`
- WHEN validated
- THEN `NO_QUERY` error, exit `1`

### Requirement: Retry with Backoff

Retry on HTTP 429/5xx: 500ms initial, 8s max, 6 retries, 0–500ms jitter.

#### Scenario: 429 recovery

- GIVEN first fetch returns 429
- WHEN retried
- THEN succeeds on subsequent 200

#### Scenario: Exhausted

- GIVEN all 7 attempts return 503
- WHEN exhausted
- THEN exit `1` with `SEARCH_FAILED`

### Requirement: Parsing

Search: identify card boundaries in Defuddle markdown, extract `jk` hashes from organic URLs, null-default missing fields. Detail: extract title (`##`), company (`###`), location, contract, schedule, salary, description; null-default missing fields.

#### Scenario: Missing fields

- GIVEN card with no company, detail with no salary
- WHEN parsed
- THEN those fields are `null`, records still emitted
