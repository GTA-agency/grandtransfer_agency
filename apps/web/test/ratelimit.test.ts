import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/server/ratelimit.ts";

describe("rate limiter", () => {
  it("allows N per window per key, then resets", () => {
    const clock = { t: 0 };
    const r = new RateLimiter(() => clock.t);
    for (let i = 0; i < 3; i++) expect(r.take("a", 3, 1000)).toBe(true);
    expect(r.take("a", 3, 1000)).toBe(false);
    expect(r.take("b", 3, 1000)).toBe(true);
    clock.t = 1000;
    expect(r.take("a", 3, 1000)).toBe(true);
  });
});
