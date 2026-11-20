import { describe, expect, it } from "vitest";
import { WebConfigError, loadWebConfig } from "../src/server/webconfig.ts";

describe("web config", () => {
  it("local by default: no quotas, loopback only", () => {
    const c = loadWebConfig({});
    expect(c).toMatchObject({ publicMode: false, publicOrigin: null, trustProxy: false });
    expect(c.ai).toEqual({ messagesPerWalletPerDay: 0, dailyBudgetUsd: 0 });
  });

  it("public mode needs an https origin and turns quotas on", () => {
    const c = loadWebConfig({
      GTA_PUBLIC_MODE: "true",
      GTA_PUBLIC_ORIGIN: "https://gta.example.com",
    });
    expect(c.publicOrigin?.host).toBe("gta.example.com");
    expect(c.ai).toEqual({ messagesPerWalletPerDay: 30, dailyBudgetUsd: 3 });
    expect(() => loadWebConfig({ GTA_PUBLIC_MODE: "true" })).toThrow(WebConfigError);
    expect(() =>
      loadWebConfig({ GTA_PUBLIC_MODE: "1", GTA_PUBLIC_ORIGIN: "http://gta.example.com" }),
    ).toThrow(/https/);
    expect(() =>
      loadWebConfig({ GTA_PUBLIC_MODE: "1", GTA_PUBLIC_ORIGIN: "https://gta.example.com/app" }),
    ).toThrow(/origin/);
  });

  it("quotas can be tuned or switched off", () => {
    const c = loadWebConfig({
      GTA_PUBLIC_MODE: "yes",
      GTA_PUBLIC_ORIGIN: "https://gta.example.com",
      AI_MESSAGES_PER_WALLET_DAY: "5",
      AI_DAILY_BUDGET_USD: "0",
    });
    expect(c.ai).toEqual({ messagesPerWalletPerDay: 5, dailyBudgetUsd: 0 });
    expect(() => loadWebConfig({ AI_DAILY_BUDGET_USD: "-1" })).toThrow(WebConfigError);
  });
});
