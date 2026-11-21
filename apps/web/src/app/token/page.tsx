import type { Metadata } from "next";
import { TokenPage } from "@/components/TokenPage";
import { TOKEN_LIVE } from "@/shared/token";

export const metadata: Metadata = {
  alternates: { canonical: "/token" },
  title: TOKEN_LIVE
    ? "$GTA · Live on Robinhood Chain · Grand Transfer Agent"
    : "$GTA · Coming soon · Grand Transfer Agent",
  description: TOKEN_LIVE
    ? "The official $GTA contract address on Robinhood Chain. Check it here before you do anything."
    : "$GTA, the Grand Transfer Agent token on Robinhood Chain. Coming soon.",
};

export default function Page() {
  return <TokenPage />;
}
