import { describe, expect, it } from "vitest";
import { MOBILE_WALLETS, isMobileBrowser } from "../src/lib/mobile-wallets";

const page = new URL("https://grandtransfer.agency/pay?to=0xabc&amount=0.01&asset=eth");
const link = (id: string) => MOBILE_WALLETS.find((w) => w.id === id)!.link(page);

describe("mobile wallet links", () => {
  it("keep the page and its payment request", () => {
    expect(link("metamask")).toBe(
      "https://link.metamask.io/dapp/grandtransfer.agency/pay?to=0xabc&amount=0.01&asset=eth",
    );
    for (const id of ["bitget", "trust"]) {
      expect(new URL(link(id)).searchParams.get("url")).toBe(page.href);
    }
  });
  it("tells phones from desktops", () => {
    expect(isMobileBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isMobileBrowser("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe(true);
    expect(isMobileBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isMobileBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isMobileBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });
});
