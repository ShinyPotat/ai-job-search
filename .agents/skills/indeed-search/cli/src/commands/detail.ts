import {
  DETAIL_URL,
  defuddleFetch,
  parseJobDetail,
  writeError,
  normalizeId as helpersNormalizeId,
} from "../helpers.js"

export interface RunDetailOpts {
  id: string
  format: "json" | "plain"
}

/** Normalize a detail id (bare hash or viewjob URL) to a jk hex hash. */
export function normalizeId(input: string): string | null {
  return helpersNormalizeId(input)
}

export async function runDetail(opts: RunDetailOpts): Promise<number> {
  const hash = normalizeId(opts.id)
  if (!hash) {
    writeError(
      `Could not parse a job ID or URL from "${opts.id}". Pass a jk hash or a viewjob URL like https://es.indeed.com/viewjob?jk=...`,
      "NO_ID",
    )
    return 1
  }

  const url = `${DETAIL_URL}?jk=${hash}`

  try {
    const markdown = await defuddleFetch(url)

    if (!markdown || markdown.length < 100) {
      writeError("Job not found or page returned insufficient content", "NOT_FOUND")
      return 1
    }

    const job = parseJobDetail(markdown, url)

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
