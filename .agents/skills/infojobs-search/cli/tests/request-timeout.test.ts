import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { RetryableError, withRetry } from "../src/helpers"

const originalSetTimeout = globalThis.setTimeout

beforeEach(() => {
  globalThis.setTimeout = ((handler: () => void, _ms?: number) => {
    handler()
    return 0 as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
})

afterEach(() => {
  globalThis.setTimeout = originalSetTimeout
})

describe("withRetry", () => {
  test("recovers after a 503 and returns the 200 response", async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      if (calls === 1) throw new RetryableError("503", 503)
      return "ok"
    }, "test")

    expect(result).toBe("ok")
    expect(calls).toBe(2)
  })

  test("exhausts retries after 7 attempts of 429", async () => {
    let calls = 0
    await expect(
      withRetry(async () => {
        calls++
        throw new RetryableError("429", 429)
      }, "test"),
    ).rejects.toThrow("429")
    expect(calls).toBe(7)
  })

  test("delay progression doubles and caps at 8000ms", async () => {
    const delays: number[] = []
    globalThis.setTimeout = ((handler: () => void, ms?: number) => {
      if (ms !== undefined) delays.push(ms)
      handler()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout

    let calls = 0
    try {
      await withRetry(async () => {
        calls++
        throw new RetryableError("503", 503)
      }, "test")
    } catch {
      // expected
    }

    expect(calls).toBe(7)
    expect(delays).toHaveLength(6)
    const ranges = [
      [500, 999],
      [1000, 1499],
      [2000, 2499],
      [4000, 4499],
      [8000, 8499],
      [8000, 8499],
    ]
    for (let i = 0; i < ranges.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(ranges[i][0])
      expect(delays[i]).toBeLessThanOrEqual(ranges[i][1])
    }
  })

  test("does not retry non-retryable errors", async () => {
    let calls = 0
    await expect(
      withRetry(async () => {
        calls++
        throw new Error("nope")
      }, "test"),
    ).rejects.toThrow("nope")
    expect(calls).toBe(1)
  })
})
