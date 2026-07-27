# Proposal: add-indeed-search

## Intent

Indeed is Spain's #2 job board after InfoJobs, yet it is absent from the portal-search lineup. The candidate searches in Sevilla/Ceuta — a Spain-focused job hunt where InfoJobs alone leaves significant coverage gaps. Adding indeed-search fills this gap using the proven Defuddle-based scraping pattern already established for InfoJobs and LinkedIn.

## Scope

### In Scope
- New portal-search skill at `.agents/skills/indeed-search/`
- `search` subcommand: query indeed.es by keyword + location, return job cards (title, company, location, date, URL)
- `detail` subcommand: fetch full job description by `jk` hash
- Flag support: `--query`, `--location`, `--page`, `--limit`, `--jobage` (client-side date filter), `--format json|table|plain`
- Sponsored result filtering (exclude `pagead/clk` URLs, keep `rc/clk` organic URLs)
- Retry with exponential backoff for rate limiting
- SKILL.md frontend following the established skill template
- Integration with `/scrape` workflow for dedup and orchestration

### Out of Scope
- Indeed public API (none exists)
- Headless browser rendering (server-rendered HTML is sufficient)
- `--remote` flag for server-side filters (client-side filtering is simpler)
- Salary filtering (deferred to future iteration)
- Other Indeed country domains (es.indeed.com only for now)

## Capabilities

> This section is the CONTRACT between proposal and specs phases.
> The sdd-spec agent reads this to know exactly which spec files to create or update.
> `openspec/specs/` is currently empty — all capabilities below are NEW.

### New Capabilities
- `indeed-search`: Indeed.es portal-search skill covering search results extraction, job detail fetching, sponsored/organic filtering, and CLI interface

### Modified Capabilities
None — this is a new isolated skill directory with no impact on existing capabilities.

## Approach

Follow the established Defuddle-based scraping pattern used by infojobs-search. Indeed.es renders search results server-side, and Defuddle extracts clean markdown from the HTML. Parse markdown with regex to extract job cards and detail content. Use `https://es.indeed.com/jobs?q=<keywords>&l=<location>&start=<offset>` for search and `https://es.indeed.com/viewjob?jk=<hash>` for detail.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `.agents/skills/indeed-search/` | New | Complete skill directory: SKILL.md, cli/src/cli.ts, tests/ |
| `.claude/skills/job-scraper/` | Modified | Add indeed-search to portal list for `/scrape` orchestration |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cloudflare anti-bot blocking | Medium | Exponential backoff, respectful rate limiting, User-Agent rotation |
| Markup changes break parsing | Medium | Regex-based parsing with clear error messages; tests with saved HTML fixtures |
| Rate limiting during scraping | High | Retry with backoff; client-side `--limit` flag to cap requests |
| Sponsored results pollute results | Low | Filter `pagead/clk` URLs, keep only `rc/clk` organic URLs |

## Rollback Plan

Delete the `.agents/skills/indeed-search/` directory and remove indeed-search from the `/scrape` portal list. No database migrations or config changes to revert. Zero impact on existing skills.

## Dependencies

None — this is a new isolated skill directory with no external dependencies beyond `bun` and `defuddle` (already in the project).

## Success Criteria

- [ ] `search` subcommand returns job cards with title, company, location, date, URL
- [ ] `detail` subcommand returns full job description by `jk` hash
- [ ] Sponsored results are filtered out (only organic `rc/clk` URLs remain)
- [ ] Rate limiting handled with exponential backoff (no crashes on 429/503)
- [ ] SKILL.md follows established template and trigger phrases are defined
- [ ] `/scrape` workflow includes indeed-search in portal rotation
- [ ] Tests pass with `bun test` in the skill directory
- [ ] Linter passes with `python tools/lint_skills.py`
