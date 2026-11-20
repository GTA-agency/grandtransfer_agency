import type { Metadata } from "next";
import { TokenPage } from "@/components/TokenPage";

export const metadata: Metadata = {
  alternates: { canonical: "/token" },
  title: "$GTA · Coming soon · Grand Transfer Agent",
  description: "$GTA, the Grand Transfer Agent token on Robinhood Chain. Coming soon.",
};

export default function Page() {
  return <TokenPage />;
}
