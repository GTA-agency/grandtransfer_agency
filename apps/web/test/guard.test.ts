import { describe, expect, it } from "vitest";
import { checkRequest } from "../src/server/guard.ts";

const req = (method: string, headers: Record<string, string>) => ({
  method,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
});
const json = { "content-type": "application/json" };

describe("web request guard", () => {
  it("allows the app's own page on loopback", () => {
    expect(checkRequest(req("GET", { host: "127.0.0.1:4663" }))).toBeNull();
    expect(
      checkRequest(
        req("POST", { host: "127.0.0.1:4663", origin: "http://127.0.0.1:4663", ...json }),
      ),
    ).toBeNull();
    expect(
      checkRequest(
        req("POST", { host: "localhost:4663", origin: "http://localhost:4663", ...json }),
      ),
    ).toBeNull();
  });

  it("refuses non-loopback hosts (DNS rebinding)", () => {
    expect(checkRequest(req("GET", { host: "evil.example:4663" }))?.code).toBe("FORBIDDEN_HOST");
    expect(checkRequest(req("GET", { host: "127.0.0.1.evil.example" }))?.code).toBe(
      "FORBIDDEN_HOST",
    );
    expect(checkRequest(req("GET", {}))?.code).toBe("FORBIDDEN_HOST");
  });

  it("refuses cross-site or origin-less writes", () => {
    const h = { host: "127.0.0.1:4663", ...json };
    expect(checkRequest(req("POST", h))?.code).toBe("FORBIDDEN_ORIGIN");
    expect(checkRequest(req("POST", { ...h, origin: "https://evil.example" }))?.code).toBe(
      "FORBIDDEN_ORIGIN",
    );
    expect(checkRequest(req("POST", { ...h, origin: "http://localhost:4663" }))?.code).toBe(
      "FORBIDDEN_ORIGIN",
    );
    expect(checkRequest(req("DELETE", { ...h, origin: "null" }))?.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("lets body-less DELETEs from the app's own page through (no JSON needed)", () => {
    const h = { host: "127.0.0.1:4663", origin: "http://127.0.0.1:4663" };
    expect(checkRequest(req("DELETE", h))).toBeNull();
    expect(
      checkRequest(req("DELETE", { host: h.host, origin: "https://evil.example" }))?.code,
    ).toBe("FORBIDDEN_ORIGIN");
  });

  it("refuses non-JSON writes (simple cross-site forms)", () => {
    const h = { host: "127.0.0.1:4663", origin: "http://127.0.0.1:4663" };
    expect(checkRequest(req("POST", { ...h, "content-type": "text/plain" }))?.code).toBe(
      "JSON_ONLY",
    );
    expect(
      checkRequest(req("POST", { ...h, "content-type": "application/x-www-form-urlencoded" }))
        ?.code,
    ).toBe("JSON_ONLY");
  });
});

describe("web request guard, public mode", () => {
  const opts = { publicOrigin: new URL("https://gta.example.com") };
  const h = { host: "gta.example.com", origin: "https://gta.example.com", ...json };

  it("accepts the site's own origin only", () => {
    expect(checkRequest(req("GET", { host: "gta.example.com" }), opts)).toBeNull();
    expect(checkRequest(req("POST", h), opts)).toBeNull();
  });

  it("refuses other hosts, including loopback and look-alikes", () => {
    for (const host of ["127.0.0.1:4663", "localhost", "gta.example.com.evil.io", "evil.io"]) {
      expect(checkRequest(req("GET", { host }), opts)?.code).toBe("FORBIDDEN_HOST");
    }
  });

  it("refuses writes from any other origin, even the same host over http", () => {
    for (const origin of ["http://gta.example.com", "https://evil.io", "null"]) {
      expect(checkRequest(req("POST", { ...h, origin }), opts)?.code).toBe("FORBIDDEN_ORIGIN");
    }
  });
});
