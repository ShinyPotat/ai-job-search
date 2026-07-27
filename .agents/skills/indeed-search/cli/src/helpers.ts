// Indeed Spain scraper — uses BrightData Web Unlocker to bypass anti-bot
// protection, then `defuddle parse --md` for clean text. Falls back to direct
// scraping when BrightData is not configured. Personal use only.

import { $ } from "bun"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unlink } from "node:fs/promises"

export const SEARCH_URL = "https://es.indeed.com/jobs"
export const DETAIL_URL = "https://es.indeed.com/viewjob"
export const RESULTS_PER_PAGE = 10

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  contract: string | null
  schedule: string | null
  salary: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  rawMarkdown: string
}

export interface SearchMeta {
  count: number
  page: number
  query: string
  location?: string
  jobage?: number
}

export interface SearchOpts {
  query: string
  location?: string
  page?: number
  limit?: number | null
  jobage?: number | null
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Error thrown for transient failures that should trigger a retry. */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = "RetryableError"
  }
}

/**
 * Parse defuddle's stderr for an HTTP status code.
 * defuddle writes errors like "Error: Failed to fetch: 403\n" to stderr.
 * Returns the status number, or null if no HTTP status was found.
 */
function extractDefuddleHttpStatus(stderr: string): number | null {
  const match = stderr.match(/Failed to fetch:\s*(\d{3})/i)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Decide whether an HTTP status should trigger a retry.
 * Retry: 429 (rate-limit), 5xx (server errors), and network-level failures.
 * Do NOT retry: 403 (forbidden), 404 (not found), and other 4xx.
 */
function isRetryableStatus(status: number | null): boolean {
  if (status === null) return true   // network error, no status → retry
  if (status === 429) return true    // rate-limit
  if (status >= 500) return true     // server errors
  return false                       // 4xx (except 429) → permanent, don't retry
}

export interface RetryConfig {
  maxRetries?: number
  initialDelay?: number
  maxDelay?: number
}

/** Retry an async operation with exponential backoff + jitter. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  config?: RetryConfig,
): Promise<T> {
  const maxRetries = config?.maxRetries ?? 6
  const initialDelay = config?.initialDelay ?? 500
  const maxDelay = config?.maxDelay ?? 8000
  let delay = initialDelay
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof RetryableError) || attempt === maxRetries) {
        throw err
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, maxDelay)
    }
  }
  throw new Error(`${label} failed after ${maxRetries} retries`)
}

// ── BrightData Web Unlocker ────────────────────────────────────────────
// When configured, routes all Indeed requests through BrightData to bypass
// anti-bot protection (403 blocks). Falls back to direct scraping otherwise.

interface BrightDataConfig {
  apiKey: string
  zone: string
}

function getBrightDataConfig(): BrightDataConfig | null {
  const apiKey = process.env.BRIGHTDATA_API_KEY
  const zone = process.env.BRIGHTDATA_ZONE
  if (apiKey && zone) return { apiKey, zone }
  return null
}

/**
 * Fetch a URL through BrightData's Web Unlocker REST API.
 * Can take 30-60s as BrightData solves CAPTCHAs and rotates IPs.
 */
async function brightdataFetch(url: string): Promise<string> {
  const config = getBrightDataConfig()
  if (!config) throw new Error("BrightData not configured")

  const response = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ zone: config.zone, url, format: "raw" }),
    signal: AbortSignal.timeout(90_000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const status = response.status
    if (status === 429 || status >= 500) {
      throw new RetryableError(`BrightData request failed: HTTP ${status}`, status)
    }
    throw new Error(
      `BrightData request failed: HTTP ${status}${body ? ` — ${body.slice(0, 200)}` : ""}`,
    )
  }

  return await response.text()
}

/**
 * Run defuddle on a local HTML file to produce markdown.
 * defuddle can't read from stdin, so we write to a temp file.
 */
async function defuddleLocal(html: string): Promise<string> {
  const defuddlePath = await findDefuddle()
  const tmpPath = join(tmpdir(), `indeed_bd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.html`)

  try {
    await Bun.write(tmpPath, html)
    const result = await $`${defuddlePath} parse ${tmpPath} --md`.quiet().nothrow()
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      throw new Error(`defuddle failed to parse HTML: ${stderr.slice(0, 200)}`)
    }
    return result.stdout.toString()
  } finally {
    // Clean up temp file — ignore errors
    unlink(tmpPath).catch(() => {})
  }
}

// ── Defuddle executable ────────────────────────────────────────────────

/** Locate the defuddle executable, or throw if missing. */
async function findDefuddle(): Promise<string> {
  const which = await $`which defuddle`.quiet().nothrow()
  const path = which.stdout.toString().trim()
  if (!path) {
    throw new Error("defuddle is not available")
  }
  return path
}

/** Fetch both raw HTML and Defuddle markdown. Routes through BrightData when configured. */
export async function fetchSearchPage(url: string): Promise<{ markdown: string; html: string }> {
  const bd = getBrightDataConfig()

  // ── BrightData path: bypass anti-bot, parse HTML locally ───────────
  if (bd) {
    const html = await brightdataFetch(url)
    const markdown = await defuddleLocal(html)
    return { markdown, html }
  }

  // ── Direct path (fallback) ─────────────────────────────────────────
  return withRetry(async () => {
    const defuddlePath = await findDefuddle()

    const [mdResult, htmlResponse] = await Promise.all([
      $`${defuddlePath} parse ${url} --md`.quiet().nothrow(),
      fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15000),
      }),
    ])

    if (mdResult.exitCode !== 0) {
      const stderr = mdResult.stderr.toString()
      const status = extractDefuddleHttpStatus(stderr)
      if (!isRetryableStatus(status)) {
        throw new Error(
          status
            ? `defuddle fetch returned HTTP ${status} — this is a permanent error, not retrying`
            : `defuddle failed with permanent error: ${stderr.slice(0, 200)}`,
        )
      }
      throw new RetryableError("defuddle failed to fetch the URL")
    }

    if (!htmlResponse.ok) {
      const msg = `HTML fetch failed: ${htmlResponse.status}`
      if (htmlResponse.status === 429 || htmlResponse.status >= 500) {
        throw new RetryableError(msg, htmlResponse.status)
      }
      throw new Error(msg)
    }

    return {
      markdown: mdResult.stdout.toString(),
      html: await htmlResponse.text(),
    }
  }, "fetchSearchPage")
}

/** Fetch a single detail page. Routes through BrightData when configured. */
export async function defuddleFetch(url: string): Promise<string> {
  const bd = getBrightDataConfig()

  // ── BrightData path ────────────────────────────────────────────────
  if (bd) {
    const html = await brightdataFetch(url)
    return await defuddleLocal(html)
  }

  // ── Direct path (fallback) ─────────────────────────────────────────
  return withRetry(async () => {
    const defuddlePath = await findDefuddle()
    const result = await $`${defuddlePath} parse ${url} --md`.quiet().nothrow()
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      const status = extractDefuddleHttpStatus(stderr)
      if (!isRetryableStatus(status)) {
        throw new Error(
          status
            ? `defuddle fetch returned HTTP ${status} — this is a permanent error, not retrying`
            : `defuddle failed with permanent error: ${stderr.slice(0, 200)}`,
        )
      }
      throw new RetryableError("defuddle failed to fetch the URL")
    }
    return result.stdout.toString()
  }, "defuddleFetch")
}

/** Build an Indeed Spain search URL from options. */
export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  params.set("q", opts.query)
  if (opts.location) {
    params.set("l", opts.location)
  }
  if (opts.page && opts.page > 1) {
    params.set("start", String((opts.page - 1) * RESULTS_PER_PAGE))
  }
  return `${SEARCH_URL}?${params.toString()}`
}

/** Normalize a detail id (bare hash or viewjob URL) to a jk hex hash. */
export function normalizeId(input: string): string | null {
  if (!input) return null
  const trimmed = input.trim()

  const urlMatch = trimmed.match(/[?&]jk=([a-f0-9]+)/i)
  if (urlMatch) return urlMatch[1]

  if (/^[a-f0-9]+$/i.test(trimmed)) {
    return trimmed
  }

  return null
}

/** Extract organic jk hashes from raw Indeed HTML. Sponsored /pagead/clk URLs are ignored. */
export function extractJkHashes(html: string): string[] {
  const hashes: string[] = []
  const seen = new Set<string>()
  const re = /href="\/rc\/clk\?jk=([a-f0-9]+)[^"]*"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const hash = match[1]
    if (hash && !seen.has(hash)) {
      seen.add(hash)
      hashes.push(hash)
    }
  }
  return hashes
}

/** Check whether a markdown chunk represents a sponsored listing. */
function isSponsoredChunk(chunk: string): boolean {
  return /\b(patrocinado|sponsored)\b/i.test(chunk)
}

/** Convert a Spanish relative date string to a numeric days-ago value. */
export function parseDateToDays(dateStr: string | null): number | null {
  if (!dateStr) return null
  const normalized = dateStr.toLowerCase().trim()

  if (normalized === "hoy") return 0

  const hours = normalized.match(/hace\s+(\d+)\s+hora?s?/)
  if (hours) return Number(hours[1]) / 24

  const days = normalized.match(/hace\s+(\d+)\+?\s+d[ií]as?/)
  if (days) return Number(days[1])

  const months = normalized.match(/hace\s+(\d+)\s+mes(?:es)?/)
  if (months) return Number(months[1]) * 30

  return null
}

/** Parse a single Indeed job card from a markdown chunk. */
export function parseCardEntry(chunk: string): JobCard | null {
  const lines = chunk.split("\n").map((l) => l.trim())

  let title: string | null = null
  let titleLineIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith("## ")) {
      title = line.slice(3).trim()
      titleLineIdx = i
      break
    }
  }
  if (!title) return null

  let company: string | null = null
  for (let i = titleLineIdx + 1; i < lines.length && i < titleLineIdx + 5; i++) {
    const line = lines[i]
    if (line.startsWith("### ")) {
      company = line.slice(4).trim()
      break
    }
  }

  let location: string | null = null
  let date: string | null = null
  let contract: string | null = null
  let schedule: string | null = null
  let salary: string | null = null

  for (let i = titleLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith("- ")) continue

    const value = line.slice(2).trim()
    if (!value) continue

    if (/^hace\s+/i.test(value) || value.toLowerCase() === "hoy") {
      if (!date) date = value
      continue
    }

    if (/^contrato\s+/i.test(value)) {
      contract = value.replace(/^contrato\s+/i, "").trim()
      continue
    }

    if (/^jornada\s+/i.test(value)) {
      schedule = value.replace(/^jornada\s+/i, "").trim()
      continue
    }

    if (/^salario\s+/i.test(value) || /^\d[\d.]*\s*(?:€\s*)?[-–]\s*\d[\d.]*\s*€/i.test(value)) {
      salary = value.replace(/^salario\s+/i, "").trim()
      continue
    }

    if (
      !location &&
      /^[A-ZÁÉÍÓÚÑ]/.test(value) &&
      value.length < 60 &&
      !/^(Contrato|Jornada|Salario|Hace|Presencial|Teletrabajo|Híbrido)/i.test(value)
    ) {
      location = value
    }
  }

  return {
    id: "",
    title,
    company,
    location,
    date,
    contract,
    schedule,
    salary,
    url: "",
  }
}

/**
 * Normalize BrightData-defuddle markdown to the old direct-scraping format.
 *
 * BrightData produces:
 *   - ### Title
 *       Company Name
 *       Location
 *       - detail lines...
 *
 * We convert to:
 *   ## Title
 *   ### Company Name
 *   - Location
 *   - detail lines...
 *
 * If no BrightData-format cards are detected, the input is returned unchanged.
 */
function normalizeBrightDataMarkdown(md: string): string {
  // Detect BrightData format: cards start with "- ### " (bullet + heading)
  if (!/^- ### /m.test(md)) return md

  const lines = md.split("\n")
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // BrightData job card: "- ### Title"
    if (trimmed.startsWith("- ### ")) {
      const title = trimmed.slice(6).trim() // after "- ### "
      out.push(`## ${title}`)

      // Collect metadata lines until next "- ###" or end of list section
      i++
      const metaLines: string[] = []
      const detailLines: string[] = []
      let inDetails = false

      while (i < lines.length) {
        const next = lines[i]
        const nt = next.trim()

        // Stop at next job card or section header
        if (nt.startsWith("- ### ") || nt.startsWith("## ") || nt === "") {
          break
        }

        if (nt.startsWith("- ")) {
          inDetails = true
          detailLines.push(nt)
        } else if (!inDetails) {
          // Metadata: company, location, tags
          // Skip UI tags like "Solicitud rápida", "Nueva"
          if (!/^(Solicitud\s+rápida|Solicitud\s+directa|Nueva|Destacada)$/i.test(nt)) {
            metaLines.push(nt)
          }
        }
        i++
      }

      // First meta line is typically the company, second is location
      if (metaLines.length > 0) {
        const company = metaLines[0]
        out.push(`### ${company}`)
      }

      // Remaining meta lines and details
      for (let m = 1; m < metaLines.length; m++) {
        let val = metaLines[m]
        // Strip work-mode prefix from location lines:
        // "Teletrabajo in Madrid, Madrid provincia" → "Madrid, Madrid provincia"
        const workModeMatch = val.match(
          /^(?:Teletrabajo|Trabajo\s+h[ií]brido|Presencial|Solo\s+teletrabajo|Remoto)\s+in\s+/i,
        )
        if (workModeMatch) {
          val = val.slice(workModeMatch[0].length)
        }
        if (val.startsWith("- ")) {
          out.push(val)
        } else {
          out.push(`- ${val}`)
        }
      }

      for (const d of detailLines) {
        out.push(d)
      }

      out.push("") // blank line between cards
      continue
    }

    // Pass through non-card lines (skip BrightData page chrome)
    // Skip page header like "## Empleos de python en..."
    if (trimmed.startsWith("## ") && /\bempleos?\s+de\b/i.test(trimmed)) {
      i++
      while (i < lines.length && lines[i].trim() !== "") i++
      continue
    }

    // Skip BrightData section markers
    if (trimmed === "## Job Post Details") {
      i++
      while (i < lines.length && lines[i].trim() !== "") i++
      continue
    }

    // Skip nav/link lines
    if (trimmed.startsWith("Clasificar por:") || trimmed.startsWith("Quiero recibir") || trimmed.startsWith("Al crear una alerta")) {
      i++
      while (i < lines.length && lines[i].trim() !== "") i++
      continue
    }

    out.push(line)
    i++
  }

  return out.join("\n")
}

/** Split markdown into job-card chunks. */
function splitCardChunks(markdown: string): string[] {
  const positions: number[] = []
  const re = /\n## /g
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    positions.push(match.index + 1)
  }

  if (markdown.trimStart().startsWith("## ")) {
    positions.unshift(0)
  }

  if (positions.length === 0) {
    return []
  }

  const chunks: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]
    const end = i + 1 < positions.length ? positions[i + 1] : markdown.length
    chunks.push(markdown.slice(start, end).trim())
  }
  return chunks
}

/** Parse Indeed search results from markdown and correlate organic jk hashes from HTML. */
export function parseSearchResults(markdown: string, html?: string): JobCard[] {
  // Normalize BrightData markdown format if detected
  markdown = normalizeBrightDataMarkdown(markdown)

  const jkHashes = html ? extractJkHashes(html) : []
  const chunks = splitCardChunks(markdown)
  const cards: JobCard[] = []

  let hashIdx = 0
  for (const chunk of chunks) {
    if (isSponsoredChunk(chunk)) continue

    const card = parseCardEntry(chunk)
    if (!card) continue

    const hash = jkHashes[hashIdx]
    if (hash) {
      card.id = hash
      card.url = `${DETAIL_URL}?jk=${hash}`
    } else {
      // Fallback id when HTML is unavailable or hashes exhausted.
      card.id = `${card.title}-${card.company || "unknown"}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40)
      card.url = ""
    }
    hashIdx++
    cards.push(card)
  }

  return cards
}

/** Parse a single Indeed job detail page. */
export function parseJobDetail(markdown: string, url: string): JobDetail {
  const lines = markdown.split("\n")

  const titleMatch = markdown.match(/^## (.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : "(untitled)"

  const companyMatch = markdown.match(/^### (.+)$/m)
  const company = companyMatch ? companyMatch[1].trim() : null

  let location: string | null = null
  let date: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("- ")) continue
    const value = trimmed.slice(2)

    if (
      /^[A-ZÁÉÍÓÚÑ]/.test(value) &&
      value.length < 60 &&
      !/^(Contrato|Jornada|Salario|Hace|Presencial|Teletrabajo|Híbrido)/i.test(value)
    ) {
      location = value
    }
    if (/^hace\s+/i.test(value) || value.toLowerCase() === "hoy") {
      date = value
    }
  }

  const contractMatch = markdown.match(/Contrato\s+([^\n]+)/i)
  const scheduleMatch = markdown.match(/Jornada\s+([^\n]+)/i)

  let salary: string | null = null
  const salaryLine = lines.find((line) => {
    const trimmed = line.trim()
    return (
      trimmed.startsWith("- Salario ") ||
      /^\d[\d.]*\s*(?:€)?\s*[-–]\s*\d[\d.]*\s*€/i.test(trimmed.slice(2).trim())
    )
  })
  if (salaryLine) {
    const value = salaryLine.trim().slice(2).trim()
    const rangeMatch = value.match(
      /(\d[\d.]*\s*(?:€)?\s*[-–]\s*\d[\d.]*\s*€(?:\s*(?:Bruto|Neto))?(?:\/[\p{L}]+)?)/iu,
    )
    salary = rangeMatch
      ? rangeMatch[1].trim()
      : value.replace(/^Salario\s+/i, "").trim()
  }

  // Build description from text after the header/metadata section.
  let description = ""
  let passedHeader = false
  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      passedHeader = true
      continue
    }
    if (!passedHeader) continue

    if (trimmed.startsWith("- ") && /^(Contrato|Jornada|Salario)/i.test(trimmed.slice(2))) {
      continue
    }

    if (trimmed.length > 0) {
      description += trimmed + "\n"
    }
  }

  const hash = normalizeId(url)

  return {
    id: hash || url,
    title,
    company,
    location,
    date,
    contract: contractMatch ? contractMatch[1].trim() : null,
    schedule: scheduleMatch ? scheduleMatch[1].trim() : null,
    salary,
    url,
    description: description.trim() || null,
    rawMarkdown: markdown,
  }
}

/** Filter cards older than `jobage` days. Cards with missing dates are kept. */
export function filterByAge(cards: JobCard[], jobage: number | null): JobCard[] {
  if (!jobage || jobage <= 0) return cards
  return cards.filter((card) => {
    const days = parseDateToDays(card.date)
    return days === null || days <= jobage
  })
}

/** Cap results to `limit`. */
export function filterByLimit(cards: JobCard[], limit: number | null): JobCard[] {
  if (!limit || limit <= 0) return cards
  return cards.slice(0, limit)
}

/** Format search results for the requested output type. */
export function formatOutput(
  meta: SearchMeta,
  results: JobCard[],
  format: "json" | "table" | "plain",
): string {
  switch (format) {
    case "table":
      return formatTable(meta, results)
    case "plain":
      return formatPlain(meta, results)
    case "json":
    default:
      return JSON.stringify({ meta, results }, null, 2)
  }
}

function formatPlain(meta: SearchMeta, results: JobCard[]): string {
  const lines: string[] = []
  lines.push(`Resultados para "${meta.query}"${meta.location ? ` en ${meta.location}` : ""}`)
  lines.push(`Página ${meta.page} · ${results.length} ofertas`)
  lines.push("")
  for (const card of results) {
    lines.push(card.title)
    if (card.company) lines.push(`  Empresa: ${card.company}`)
    if (card.location) lines.push(`  Ubicación: ${card.location}`)
    if (card.date) lines.push(`  Fecha: ${card.date}`)
    lines.push(`  URL: ${card.url}`)
    lines.push("")
  }
  return lines.join("\n").trim()
}

function formatTable(meta: SearchMeta, results: JobCard[]): string {
  const headers = ["Título", "Empresa", "Ubicación", "Fecha", "URL"]
  const rows = results.map((c) => [
    c.title,
    c.company || "",
    c.location || "",
    c.date || "",
    c.url,
  ])
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  )

  const formatRow = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join(" | ")

  const lines: string[] = []
  lines.push(`Resultados para "${meta.query}"${meta.location ? ` en ${meta.location}` : ""}`)
  lines.push(`Página ${meta.page} · ${results.length} ofertas`)
  lines.push("")
  lines.push(formatRow(headers))
  lines.push(widths.map((w) => "-".repeat(w)).join("-+-"))
  for (const row of rows) {
    lines.push(formatRow(row))
  }
  return lines.join("\n").trim()
}
