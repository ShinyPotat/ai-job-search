# Proposal: Fix InfoJobs CLI

## Intent

The infojobs-search CLI has 3 blocking bugs (null contract/schedule/salary, broken detail command, no retry) and lacks feature parity with the linkedin-search reference CLI (missing filters, zero tests). Users cannot extract complete job metadata or reliably fetch details, and the CLI fails hard on transient errors.

## Scope

### In Scope
- Fix `parseCardEntry` metadata extraction to capture contract/schedule/salary after description text
- Fix `normalizeId` to construct proper job detail URLs for `of-i` IDs
- Add exponential backoff retry (6 attempts, matching linkedin CLI pattern)
- Add `--jobage`, `--remote`, `--location` search flags
- Add test suite (parsing, flags, retry, search, detail)
- Correct SKILL.md documentation to match actual behavior

### Out of Scope
- HTTP fallback (not implemented; SKILL.md will be corrected)
- Pagination beyond page parameter
- Rate limiting or request throttling
- Multi-language support

## Capabilities

### New Capabilities
- `infojobs-search-cli`: Complete InfoJobs job search and detail extraction with retry, filtering, and test coverage

### Modified Capabilities
None (no existing specs)

## Approach

1. **Fix parsing bug**: Remove early `break` in `parseCardEntry` metadata loop (helpers.ts:265). Continue scanning all bullet lines to capture contract/schedule/salary that appear after description text in defuddle markdown.

2. **Fix detail URL construction**: Replace search URL pattern in `normalizeId` (detail.ts:27,32) with direct job URL: `${BASE_URL}/.../${hash}` or resolve via search if needed.

3. **Add retry/backoff**: Port linkedin's `htmlFetch` pattern (helpers.ts:20-50) to infojobs `defuddleFetch`. Wrap fetch calls with 6-retry exponential backoff on 429/5xx.

4. **Add filter flags**: Extend `SearchOpts` and `buildUrl` in search.ts. `--location` appends to keyword query. `--jobage` and `--remote` apply client-side filters on parsed results (matching linkedin CLI behavior).

5. **Add tests**: Create `tests/` directory with 5 files mirroring linkedin structure: `parsing.test.ts`, `cli-flag-validation.test.ts`, `request-timeout.test.ts`, `search.test.ts`, `helpers.ts`. Target 70%+ coverage on critical paths.

6. **Fix documentation**: Update SKILL.md to remove HTTP fallback claims. Document actual defuddle-only behavior.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `cli/src/helpers.ts` | Modified | Fix parseCardEntry break logic, add retry to defuddleFetch |
| `cli/src/commands/detail.ts` | Modified | Fix normalizeId URL construction |
| `cli/src/commands/search.ts` | Modified | Add --jobage, --remote, --location flags and filtering |
| `cli/tests/` | New | 5 test files (parsing, flags, retry, search, helpers) |
| `SKILL.md` | Modified | Correct HTTP fallback claims |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Defuddle markdown structure changes | Low | Tests lock current behavior; regex patterns are specific |
| InfoJobs blocks defuddle requests | Med | Retry backoff handles transient blocks; no mitigation for permanent blocks |
| Client-side filtering misses edge cases | Med | Test with real "Hace Xh/d" and remote patterns from actual pages |
| Test suite maintenance burden | Low | Follow linkedin test patterns; keep tests focused on parsing logic |

## Rollback Plan

Revert commit(s). No database or state changes. CLI reverts to broken state (current baseline).

## Dependencies

- `defuddle` CLI must be installed (existing requirement)
- `bun` runtime (existing requirement)

## Success Criteria

- [ ] `search` command returns non-null contract/schedule/salary for jobs with those fields
- [ ] `detail of-i<hash>` fetches and parses job detail page correctly
- [ ] Transient HTTP errors succeed after retry (visible in logs or test)
- [ ] `--jobage 7` filters out jobs older than 7 days
- [ ] `--remote teletrabajo` filters to remote-only jobs
- [ ] `--location "Madrid"` appends to search query
- [ ] Test suite passes: `bun test` exits 0
- [ ] SKILL.md accurately describes CLI behavior
