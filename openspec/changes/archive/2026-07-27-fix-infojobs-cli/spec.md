# InfoJobs Search CLI Specification

## Purpose

Behavior of the InfoJobs search CLI — scrapes InfoJobs (Spain) public pages via `defuddle` for job search, metadata extraction, and detail fetching.

## Requirements

### Requirement: Metadata Extraction

The CLI MUST extract `contract`, `schedule`, and `salary` from search cards even when those bullets appear after description text in defuddle markdown.

#### Scenario: Metadata after description text

- GIVEN a card where description text precedes `- Contrato`, `- Jornada`, and salary bullets
- WHEN `parseSearchResults` processes the markdown
- THEN `contract`, `schedule`, and `salary` MUST be non-null

#### Scenario: Metadata absent

- GIVEN a card with no contract/schedule/salary bullets
- WHEN parsed
- THEN those fields MUST be `null`

### Requirement: Detail URL Construction

The `detail` command MUST accept `of-i<hash>` IDs and resolve them to the correct job detail page (not a search URL).

#### Scenario: of-i hash input

- GIVEN input `of-i64b301a63c4aa49ca23fc625897482`
- WHEN `normalizeId` processes it
- THEN the URL MUST target the job detail page directly

#### Scenario: Full URL input

- GIVEN a full InfoJobs URL containing `of-i<hash>`
- WHEN processed
- THEN the URL MUST be used as-is

#### Scenario: Unparseable input

- GIVEN input with no `of-i` hash and no valid URL
- WHEN processed
- THEN the CLI MUST exit 1 with code `BAD_ID`

### Requirement: HTTP Retry with Exponential Backoff

All HTTP requests MUST retry up to 6 times with exponential backoff on 429/5xx, matching the linkedin CLI `htmlFetch` pattern.

#### Scenario: Transient failure recovers

- GIVEN first request returns 503, second returns 200
- WHEN retry logic executes
- THEN the successful response MUST be returned

#### Scenario: Retries exhausted

- GIVEN all 7 attempts return 429
- WHEN retries exhaust
- THEN an error with the status code MUST be thrown

#### Scenario: Backoff parameters

- GIVEN a retryable response
- WHEN computing delay
- THEN delay MUST start ~500ms, double per attempt (cap 8000ms), with random jitter

### Requirement: Search Filter Flags

The `search` command MUST accept `--jobage <days>`, `--remote <remote|hybrid|onsite>`, and `--location <city>`.

#### Scenario: --jobage filters old jobs

- GIVEN `--jobage 7`
- WHEN results are returned
- THEN jobs older than 7 days MUST be excluded (client-side)

#### Scenario: --remote filters workplace type

- GIVEN `--remote teletrabajo`
- WHEN results are returned
- THEN only remote-matching cards MUST be emitted

#### Scenario: --location appends to query

- GIVEN `--location "Madrid"` with `--query "developer"`
- WHEN URL is built
- THEN keyword MUST include both query and location

#### Scenario: Invalid flag value

- GIVEN `--jobage foo`
- WHEN parsed
- THEN exit 1 with code `BAD_ARG`

### Requirement: Test Suite

The CLI MUST include tests under `cli/tests/` covering parsing, flag validation, retry, and search — mirroring linkedin-search structure.

#### Scenario: Required test files

- GIVEN `cli/tests/`
- WHEN inspected
- THEN it MUST contain: `parsing.test.ts`, `cli-flag-validation.test.ts`, `request-timeout.test.ts`, `search.test.ts`, `helpers.ts`

#### Scenario: Suite passes

- GIVEN implementation matches this spec
- WHEN `bun test` runs
- THEN exit code MUST be 0

### Requirement: Documentation Accuracy

SKILL.md MUST accurately describe actual CLI behavior — no unimplemented feature claims.

#### Scenario: No HTTP fallback claim

- GIVEN SKILL.md
- WHEN reviewed
- THEN it MUST NOT claim HTTP fallback when defuddle is unavailable

#### Scenario: Flag documentation parity

- GIVEN SKILL.md flag list vs actual parser
- WHEN compared
- THEN documented and implemented flags MUST match exactly
