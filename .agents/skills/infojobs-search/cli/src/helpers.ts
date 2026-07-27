// InfoJobs scraper — uses `defuddle parse --md` to extract clean markdown from
// InfoJobs search and detail pages. No API key required. Personal use only.

import { $ } from "bun"

export const SEARCH_URL =
  "https://www.infojobs.net/jobsearch/search-results/list.xhtml"

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

/** Retry an async operation with exponential backoff + jitter. */
export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof RetryableError) || attempt === maxRetries) {
        throw err
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
    }
  }
  throw new Error(`${label} failed after ${maxRetries} retries`)
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  remote: string | null
  date: string | null
  contract: string | null
  schedule: string | null
  salary: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  requirements: string | null
  offer: string | null
  rawMarkdown: string
}

/** Fetch both raw HTML (for URLs) and defuddle markdown (for text). */
export async function fetchSearchPage(url: string): Promise<{ markdown: string; html: string }> {
  return withRetry(async () => {
    const which = await $`which defuddle`.quiet().nothrow()
    const defuddlePath = which.stdout.toString().trim()

    const [mdResult, htmlResponse] = await Promise.all([
      defuddlePath
        ? $`${defuddlePath} parse ${url} --md`.quiet().nothrow()
        : Promise.resolve(null),
      fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15000),
      }),
    ])

    if (!defuddlePath || mdResult === null || mdResult.exitCode !== 0) {
      throw new RetryableError("defuddle is not available or failed to fetch the URL")
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

/** Fetch both raw HTML and defuddle markdown for a detail page. */
export async function fetchDetailPage(url: string): Promise<{ markdown: string; html: string }> {
  const which = await $`which defuddle`.quiet().nothrow()
  const defuddlePath = which.stdout.toString().trim()

  const [mdResult, htmlResponse] = await Promise.all([
    defuddlePath
      ? $`${defuddlePath} parse ${url} --md`.quiet().nothrow()
      : Promise.resolve(null),
    fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    }),
  ])

  if (!htmlResponse.ok) {
    throw new Error(`HTML fetch failed: ${htmlResponse.status}`)
  }

  return {
    markdown: mdResult && mdResult.exitCode === 0 ? mdResult.stdout.toString() : "",
    html: await htmlResponse.text(),
  }
}

/** Fetch a single detail page via defuddle. */
export async function defuddleFetch(url: string): Promise<string> {
  return withRetry(async () => {
    const which = await $`which defuddle`.quiet().nothrow()
    const defuddlePath = which.stdout.toString().trim()

    if (!defuddlePath) {
      throw new Error("defuddle is not available")
    }

    const result = await $`${defuddlePath} parse ${url} --md`.quiet().nothrow()
    if (result.exitCode !== 0) {
      throw new RetryableError("defuddle failed to fetch the URL")
    }
    return result.stdout.toString()
  }, "defuddleFetch")
}

/**
 * Extract job URLs (of-i hashes) from the raw HTML of the search page.
 * Returns a map from title -> full URL.
 */
export function extractJobUrls(html: string): Map<string, string> {
  const urlMap = new Map<string, string>()

  // InfoJobs job links in search results look like:
  // <a href="//www.infojobs.net/city/title-slug/of-i<hash>?...">
  // We extract both the URL and the associated title
  const linkRe = /href="\/\/(www\.infojobs\.net\/(?!jobsearch\/)[^"]*?of-i[a-f0-9]+)[^"]*"/g
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(html)) !== null) {
    const url = "https://" + match[1].replace(/&amp;/g, "&")
    // Try to find the title near this link — it's usually in a heading or data attribute
    // For now, extract the slug portion as a secondary key
    const slugMatch = url.match(/\/[^/]+\/([^/]+)\/of-i/)
    if (slugMatch) {
      urlMap.set(slugMatch[1], url)
    }
  }

  // Also try extracting by data attributes
  const dataRe = /data-offer-url="([^"]*of-i[a-f0-9]+[^"]*)"/g
  while ((match = dataRe.exec(html)) !== null) {
    const url = match[1].replace(/&amp;/g, "&")
    if (!url.startsWith("http")) {
      urlMap.set(url, "https://www.infojobs.net" + url)
    } else {
      urlMap.set(url, url)
    }
  }

  return urlMap
}

/**
 * Try to find the best matching URL for a job card from the extracted URL map.
 * Matches by slug similarity to the title.
 */
function matchJobUrl(card: JobCard, urlMap: Map<string, string>): string {
  // Try to match by company page link
  for (const [slug, url] of urlMap) {
    // Normalize title to slug-like form
    const titleSlug = card.title
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñ]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)

    // Check if the URL slug contains parts of the title
    const urlLower = url.toLowerCase()
    const titleWords = titleSlug.split("-").filter((w) => w.length > 2)

    let matchCount = 0
    for (const word of titleWords) {
      if (urlLower.includes(word)) matchCount++
    }

    // If at least 2 significant words match, it's probably the right URL
    if (matchCount >= 2 || (titleWords.length <= 2 && matchCount >= 1)) {
      return url
    }
  }

  // Fallback: return first URL that has any title word match
  for (const [slug, url] of urlMap) {
    const titleWords = card.title.toLowerCase().split(/\s+/)
    for (const word of titleWords) {
      if (word.length > 3 && url.toLowerCase().includes(word)) {
        return url
      }
    }
  }

  return card.url
}

/**
 * Parse InfoJobs search results from defuddle markdown output.
 *
 * Each job card in the defuddle output starts with:
 * `- [![](logo_url)](company_link)` followed by:
 *   optional "Destacada"
 *   ## Job Title
 *   ### Company
 *   - Location
 *   - Presencial / Teletrabajo / Híbrido
 *   - Hace Xh / date
 *   description text...
 *   - Contrato ...
 *   - Jornada ...
 *   - Salary ...
 */
export function parseSearchResults(markdown: string, html?: string): JobCard[] {
  const cards: JobCard[] = []
  const urlMap = html ? extractJobUrls(html) : new Map()

  // Split by job card boundaries: each card starts with "- [!["
  // We use a lookbehind-like approach: find indices of "- [![" and split
  const cardStarts: number[] = []
  const re = /\n- \[!/g
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    cardStarts.push(match.index + 1) // +1 to skip the \n
  }

  if (cardStarts.length === 0) return cards

  // Extract each chunk between card starts (plus the last one to end)
  for (let i = 0; i < cardStarts.length; i++) {
    const start = cardStarts[i]
    const end = i + 1 < cardStarts.length ? cardStarts[i + 1] : markdown.length
    const chunk = markdown.slice(start, end)
    const card = parseCardEntry(chunk)
    if (card) {
      // Try to match with a real InfoJobs URL from the HTML
      card.url = matchJobUrl(card, urlMap)
      // Update ID from URL if possible
      const urlHash = card.url.match(/of-i([a-f0-9]+)/i)
      if (urlHash) card.id = urlHash[0]
      cards.push(card)
    }
  }

  // Deduplicate by ID
  const seen = new Set<string>()
  return cards.filter((c) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })
}

export function parseCardEntry(chunk: string): JobCard | null {
  const lines = chunk.split("\n")

  // Try to extract the offer URL from the logo link
  // `- [![](logo)](https://company.ofertas-trabajo.infojobs.net/)`
  const urlMatch = lines[0]?.match(/\]\(([^)]+)\)/)
  const url = urlMatch ? urlMatch[1] : ""

  // Find title: the line starting with "## " (after optional "Destacada")
  let title: string | null = null
  let titleLineIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith("## ")) {
      title = line.slice(3).trim()
      titleLineIdx = i
      break
    }
  }
  if (!title) return null

  // Skip the header line "N ofertas de..."
  if (/^\d[\d,.]*\s+ofertas?\s+de\b/i.test(title)) return null

  // Find company: the line starting with "### " (usually right after title)
  let company: string | null = null
  for (let i = titleLineIdx + 1; i < lines.length && i < titleLineIdx + 5; i++) {
    const line = lines[i].trim()
    if (line.startsWith("### ")) {
      company = line.slice(4).trim()
      break
    }
  }

  // Extract metadata: location, date from the bullet lines after company
  let location: string | null = null
  let remote: string | null = null
  let date: string | null = null
  let contract: string | null = null
  let schedule: string | null = null
  let salary: string | null = null

  // After the ### Company line, metadata lines are `- value`
  // The location is the first `- City` line that's NOT "Presencial", "Teletrabajo", "Híbrido", date, contract, schedule, salary
  for (let i = titleLineIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith("- ")) {
      // Description text and headings do not end metadata scanning; continue
      // so that contract/schedule/salary bullets after the description are found.
      continue
    }

    const value = line.slice(2).trim()

    // Skip "Ver ofertas" and other generic lines
    if (value === "Ver ofertas") continue

    // Detect remote/workplace type
    const remoteMatch = value.match(/^(Presencial|Teletrabajo|Híbrido)/i)
    if (remoteMatch) {
      remote = remoteMatch[1]!
      continue
    }

    // Date lines
    if (/^Hace\s+(\d+[hdm]|un\s+día|unos?\s+\w+)/i.test(value)) {
      date = value
      continue
    }

    // Skip "(Publicada de nuevo)" and similar
    if (/^\((Publicada|Nueva)/i.test(value)) continue

    // Contract
    if (/^Contrato\s+/i.test(value)) {
      contract = value.replace(/^Contrato\s+/i, "").trim()
      continue
    }

    // Schedule
    if (/^Jornada\s+/i.test(value)) {
      schedule = value.replace(/^Jornada\s+/i, "").trim()
      continue
    }

    // Salary
    if (/^Salario\s+/i.test(value) || /^\d[\d.]*\s*(?:€\s*)?[-–]\s*\d[\d.]*\s*€/i.test(value)) {
      salary = value.replace(/^Salario\s+/i, "").trim()
      continue
    }

    // If we haven't found the location yet, and this line looks like a city name
    // (starts with uppercase, not too long, not a date, not the remote flag line)
    if (!location && /^[A-ZÁÉÍÓÚ]/.test(value) && value.length < 60) {
      location = value
    }
  }

  // Generate ID from URL or from of-i pattern in the chunk
  let id: string
  const hashMatch = chunk.match(/of-i([a-f0-9]+)/i)
  if (hashMatch) {
    id = hashMatch[0]
  } else {
    id = `${title}-${company || "unknown"}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)
  }

  return {
    id,
    title,
    company,
    location,
    remote,
    date,
    contract,
    schedule,
    salary,
    url,
  }
}

export function parseDateToDays(dateStr: string | null): number | null {
  if (!dateStr) return null
  const h = dateStr.match(/Hace\s+(\d+)\s*h/i)
  if (h) return Number(h[1]) / 24
  const d = dateStr.match(/Hace\s+(\d+)\s*d/i)
  if (d) return Number(d[1])
  if (/Hace\s+un\s+día/i.test(dateStr)) return 1
  if (/Hace\s+unos?\s+días/i.test(dateStr)) return 3
  return null
}

export function matchesWorkplaceType(card: JobCard, mode: string): boolean {
  if (!card.remote || !mode) return false
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  const cardRemote = normalize(card.remote)
  const input = normalize(mode)
  const map: Record<string, string> = {
    remote: "teletrabajo",
    teletrabajo: "teletrabajo",
    hybrid: "hibrido",
    hibrido: "hibrido",
    híbrido: "hibrido",
    onsite: "presencial",
    presencial: "presencial",
  }
  const target = map[input]
  if (!target) return false
  return cardRemote === target
}

/**
 * Parse a job detail page.
 */
export function parseJobDetail(markdown: string, url: string, html?: string): JobDetail {
  const lines = markdown.split("\n")

  // Title: first try markdown ## heading, then HTML <h1> tag
  let title: string = "(untitled)"
  const titleMatch = markdown.match(/^## (.+)$/m)
  if (titleMatch) {
    title = titleMatch[1].trim()
  } else if (html) {
    const h1Match = html.match(/<h1[^>]*class="[^"]*ij-Heading[^"]*ij-Heading-title1[^"]*"[^>]*>([^<]+)</i)
    if (h1Match) title = h1Match[1].trim()
  }

  // Company: first try markdown ### heading, then HTML "Más ofertas en" link
  let company: string | null = null
  const companyMatch = markdown.match(/^### (.+)$/m)
  if (companyMatch) {
    const raw = companyMatch[1].trim()
    // Don't use section headers like "Requisitos", "Descripción" as company name
    if (!/^(Requisitos|Descripción|Qué\s|Se\s|Ofrecemos|Condiciones|Beneficios|Estudios|Experiencia|Conocimientos)/i.test(raw)) {
      company = raw
    }
  }
  if (!company && html) {
    const coMatch = html.match(/<a[^>]*title="Más ofertas en ([^"]+)"[^>]*>([^<]+)</i)
    if (coMatch) company = coMatch[2].trim()
  }

  // Parse metadata lines
  let location: string | null = null
  let date: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("- ")) continue
    const value = trimmed.slice(2)

    if (/^[A-ZÁÉÍÓÚ]/.test(value) && value.length < 60 && !/^(Presencial|Teletrabajo|Híbrido|Contrato|Jornada|Salario|Hace)/i.test(value)) {
      location = value
    }
    if (/^Hace\s+(\d+[hdm]|un\s+día)/i.test(value)) {
      date = value
    }
  }

  // Extract sections
  let description = ""
  let requirements = ""
  let offer = ""
  let currentSection: "desc" | "req" | "offer" = "desc"

  let passedHeader = false
  let foundFirstDescLine = false
  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      passedHeader = true
      continue
    }
    if (!passedHeader) continue

    // Skip metadata bullet lines
    if (trimmed.startsWith("- ") && (!foundFirstDescLine || /^(Contrato|Jornada|Salario)/i.test(trimmed.slice(2)))) {
      continue
    }

    // Detect section breaks
    if (/^(Requisitos|Qué buscamos|Perfil requerido|Formación requerida)/i.test(trimmed)) {
      currentSection = "req"
      continue
    }
    if (/^(Qué ofrecemos|Se ofrece|Condiciones|Ofrecemos|Beneficios)/i.test(trimmed)) {
      currentSection = "offer"
      continue
    }
    // Skip "Inscribir" / "Apuntar" call-to-action lines
    if (/^(Inscríbete|Apúntate|Si te interesa|No dudes)/i.test(trimmed)) continue

    if (trimmed.length === 0) continue
    foundFirstDescLine = true

    if (currentSection === "desc") description += trimmed + "\n"
    else if (currentSection === "req") requirements += trimmed + "\n"
    else if (currentSection === "offer") offer += trimmed + "\n"
  }

  // Contract, schedule, salary from detail
  const contractMatch = markdown.match(/Contrato\s+([^\n]+)/i)
  const scheduleMatch = markdown.match(/Jornada\s+([^\n]+)/i)
  const salaryMatch = markdown.match(/(\d+\.?\d*\s*[-–]\s*\d+\.?\d*\s*€\s*(?:Bruto|Neto)?(?:\/[a-z]+)?)/i)

  const idMatch = url.match(/of-i([a-f0-9]+)/i)
  const id = idMatch ? idMatch[0] : url

  return {
    id,
    title,
    company,
    location,
    remote: null,
    date,
    contract: contractMatch ? contractMatch[1].trim() : null,
    schedule: scheduleMatch ? scheduleMatch[1].trim() : null,
    salary: salaryMatch ? salaryMatch[1].trim() : null,
    url,
    description: description.trim() || null,
    requirements: requirements.trim() || null,
    offer: offer.trim() || null,
    rawMarkdown: markdown,
  }
}
