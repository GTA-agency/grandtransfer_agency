import type { Metadata, Viewport } from "next";
import { Anton, Inter } from "next/font/google";
import "./globals.css";

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://grandtransfer.agency"),
  title: "Grand Transfer Agent",
  description:
    "Your AI wallet agent for Robinhood Chain. You call the shots. The agent makes the run.",
  openGraph: {
    type: "website",
    url: "https://grandtransfer.agency",
    siteName: "Grand Transfer Agent",
    title: "Grand Transfer Agent",
    description:
      "Your AI wallet agent for Robinhood Chain. You call the shots. The agent makes the run.",
  },
  twitter: { card: "summary_large_image", site: "@grandtransferHQ", creator: "@grandtransferHQ" },
};

export const viewport: Viewport = {
  themeColor: "#0e0f1d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (wallets, translators) add attributes to
    // <html>/<body> before React loads; that is not a bug in the page.
    <html lang="en" className={`${anton.variable} ${inter.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
