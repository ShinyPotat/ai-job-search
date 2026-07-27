# Tasks: Add Indeed Search Skill

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,100 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: helpers.ts → PR 2: cli.ts + commands → PR 3: tests + config + SKILL.md |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | helpers.ts (types, fetch, retry, parse, filter, format) | PR 1 | Base: main. Self-contained foundation. |
| 2 | cli.ts, search.ts, detail.ts | PR 2 | Base: PR 1 branch. Depends on helpers exports. |
| 3 | 4 test files, package.json, tsconfig.json, SKILL.md | PR 3 | Base: PR 2 branch. Tests verify previous work. |

## Phase 1: Foundation

- [x] 1.1 Create `helpers.ts` — types (JobCard, JobDetail, SearchMeta, SearchOpts), withRetry, fetchSearchPage, defuddleFetch
- [x] 1.2 Create `helpers.ts` — buildUrl, normalizeId, extractJkHashes from raw HTML
- [x] 1.3 Create `helpers.ts` — parseSearchResults, parseCardEntry, parseJobDetail, parseDateToDays
- [x] 1.4 Create `helpers.ts` — filterByAge, filterByLimit, formatOutput (json/table/plain)

## Phase 2: CLI & Commands

- [ ] 2.1 Create `cli.ts` — flag parsing, subcommand dispatch, error codes (NO_QUERY, NO_ID, BAD_ARG, BAD_CMD)
- [ ] 2.2 Create `commands/search.ts` — buildUrl, runSearch, emit with format and filters
- [ ] 2.3 Create `commands/detail.ts` — normalizeId, defuddleFetch, parse, emit detail or NOT_FOUND

## Phase 3: Tests

- [ ] 3.1 Create `tests/parsing.test.ts` — parseCardEntry, parseSearchResults, parseJobDetail, extractJkHashes with HTML/markdown fixtures
- [ ] 3.2 Create `tests/search.test.ts` — runSearch E2E with mocked fetchSearchPage, filterByAge/limit
- [ ] 3.3 Create `tests/request-timeout.test.ts` — withRetry: 429→200 recovery, 503 exhaust
- [ ] 3.4 Create `tests/cli-flag-validation.test.ts` — each error code via bun run, assert stderr JSON + exit 1

## Phase 4: Config & Docs

- [ ] 4.1 Create `package.json` — bun project config with test/typecheck scripts
- [ ] 4.2 Create `tsconfig.json` — strict TypeScript, bundler resolution
- [ ] 4.3 Create `SKILL.md` — frontmatter, usage docs, trigger phrases, allowed-tools
