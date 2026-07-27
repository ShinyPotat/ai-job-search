import {
  fetchDetailPage,
  parseJobDetail,
  writeError,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/**
 * Accept a job ID (of-i<hash>), a full InfoJobs URL, or just a hash.
 */
async function normalizeId(input: string): Promise<{ url: string } | null> {
  // Full URL: https://www.infojobs.net/sevilla/tecnico-calibracion/of-i64b301a...
  if (input.startsWith("http")) {
    const match = input.match(/of-i[a-f0-9]+/i)
    if (match) return { url: input }
    return null
  }

  // of-i<hash> or just the hash part -> canonical short URL
  const hashMatch = input.match(/(?:of-)?(i[a-f0-9]+)/i)
  if (hashMatch) {
    const hash = hashMatch[0].startsWith("of-i") ? hashMatch[0] : `of-i${hashMatch[0]}`
    return { url: `https://www.infojobs.net/jobsearch/job-detail/${hash}` }
  }

  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const normalized = await normalizeId(opts.id)
  if (!normalized) {
    writeError(
      `Could not parse a job ID or URL from "${opts.id}". Pass a full URL like https://www.infojobs.net/.../of-i<hash>`,
      "BAD_ID",
    )
    return 1
  }

  try {
    const { markdown, html } = await fetchDetailPage(normalized.url)

    if (!markdown || markdown.length < 50) {
      writeError("Job not found or page returned insufficient content", "NOT_FOUND")
      return 1
    }

    const job = parseJobDetail(markdown, normalized.url, html)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.contract ? `Contract: ${job.contract}` : "",
        job.schedule ? `Schedule: ${job.schedule}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        "",
        job.description || "(no description)",
        "",
        job.requirements ? `Requirements:\n${job.requirements}` : "",
        "",
        job.offer ? `Offer:\n${job.offer}` : "",
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
