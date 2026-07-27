# Tasks: Fix InfoJobs CLI

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~460 (180 modified + 280 new tests) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (core fixes: bugfixes + retry) → PR 2 (features: flags + tests + docs) |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Core bugfixes + retry infrastructure | PR 1 | Fix parseCardEntry, detail normalizeId, add withRetry. Matches deliverables 1-3. |
| 2 | Feature flags + test suite + docs | PR 2 | Add --jobage/--remote/--location, write tests, fix SKILL.md. Depends on PR 1 for stable code. |

## Phase 1: Core Bugfixes & Retry (deliverables 1-3)

- [x] 1.1 Fix `parseCardEntry` in `cli/src/helpers.ts`: remove early `break` at L265 so metadata scanning continues past description text
- [x] 1.2 Add `withRetry<T>(fn, label)` wrapper in `cli/src/helpers.ts`: 6 retries, exp backoff (~500ms base, double per attempt, cap 8s, random jitter), retry on 429/5xx or non-zero defuddle exit
- [x] 1.3 Add `resolveJobUrl(hash)` in `cli/src/helpers.ts`: fetches search page, runs `extractJobUrls`, matches by hash, returns full URL or null
- [x] 1.4 Wrap `fetchSearchPage` and `defuddleFetch` calls with `withRetry` in `cli/src/helpers.ts`
- [x] 1.5 Fix `normalizeId` in `cli/src/commands/detail.ts`: replace search-URL fallback with `resolveJobUrl()` call

## Phase 2: Filter Flags (deliverable 4)

- [x] 2.1 Add `parseDateToDays(dateStr)` and `matchesWorkplaceType(card, mode)` in `cli/src/helpers.ts`
- [x] 2.2 Extend `SearchOpts` in `cli/src/commands/search.ts` with `jobage?`, `remote?`, `location?` fields
- [x] 2.3 Modify `buildUrl` in `cli/src/commands/search.ts` to append location to the keyword param
- [x] 2.4 Add `filterByAge()` and `filterByRemote()` post-processing in `cli/src/commands/search.ts` after `parseSearchResults`
- [x] 2.5 Add `--jobage`, `--remote`, `--location` flag parsing in `cli/src/cli.ts` with `parseIntFlag` validation for `--jobage`
- [x] 2.6 Update HELP text in `cli/src/cli.ts` with new flag documentation

## Phase 3: Test Suite (deliverable 5)

- [x] 3.1 Create `cli/tests/helpers.ts` — `runCLI()` subprocess runner and `parseJSON()` stdout parser (mirror linkedin pattern)
- [x] 3.2 Create `cli/tests/parsing.test.ts` — test `parseCardEntry` with metadata-after-description markdown, `parseJobDetail` edge cases, `parseDateToDays`, `matchesWorkplaceType`
- [x] 3.3 Create `cli/tests/cli-flag-validation.test.ts` — test `--jobage foo` exits 1 with `BAD_ARG`, valid flag values pass, `--remote teletrabajo` filtering
- [x] 3.4 Create `cli/tests/request-timeout.test.ts` — test `withRetry` backoff behavior (recovery after 503, exhaustion after 7x429, delay progression)
- [x] 3.5 Create `cli/tests/search.test.ts` — mock `fetchSearchPage`, verify filter application and output format
- [x] 3.6 Add `"test": "bun test --timeout 30000"` script to `cli/package.json`

## Phase 4: Documentation (deliverable 6)

- [x] 4.1 Fix `SKILL.md`: remove "Falls back to direct HTTP if unavailable" line
- [x] 4.2 Add `--jobage`, `--remote`, `--location` to documented flags in `SKILL.md`
- [x] 4.3 Document of-i resolution via search lookup as known limitation in `SKILL.md`
