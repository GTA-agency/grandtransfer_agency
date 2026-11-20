import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  title: "Privacy Policy · Grand Transfer Agent",
  description: "What Grand Transfer Agent stores, why, and who it is shared with.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="20 November 2026">
      <p>
        This page explains what Grand Transfer Agent (&ldquo;the app&rdquo;) stores when you use it
        at grandtransfer.agency, why, and who it is shared with. In short: we keep the minimum
        needed to run your crew and your books, we never have your keys, and we don&apos;t sell or
        track you.
      </p>

      <h2>What we never collect</h2>
      <ul>
        <li>Private keys, recovery phrases or wallet passwords.</li>
        <li>Your name, email, phone number or ID documents. There are no accounts.</li>
        <li>Advertising or analytics trackers. The app sets no tracking cookies.</li>
      </ul>

      <h2>What we store, and why</h2>
      <ul>
        <li>
          <strong>Your wallet address</strong>: to sign you in (Sign-In with Ethereum) and keep your
          data separate from everyone else&apos;s.
        </li>
        <li>
          <strong>Your crew, categories and notes</strong>: the contact names and addresses, custom
          categories and transaction notes you add.
        </li>
        <li>
          <strong>Your books</strong>: a record of transfers to and from your wallet. This data is
          already public on Robinhood Chain; we keep a copy so recaps and charts work.
        </li>
        <li>
          <strong>Usage counters</strong>: how many agent messages each wallet used today and their
          cost, to enforce the daily allowance.
        </li>
        <li>
          <strong>A session cookie</strong> (<code>__Host-gta_session</code>): a random token that
          keeps you signed in for up to 12 hours of inactivity. It is strictly necessary and is
          deleted when you disconnect.
        </li>
      </ul>
      <p>
        This data is stored on Cloudflare&apos;s infrastructure, where the app runs. Your current
        chat conversation is kept only in the server&apos;s memory and is cleared when you start a
        new chat, disconnect, or the server restarts.
      </p>

      <h2>Who we share it with</h2>
      <ul>
        <li>
          <strong>OpenRouter and the AI model provider</strong> receive the messages you send to the
          agent, together with the wallet data the agent looks up to answer (for example your
          balance, contact names and addresses, or recent transactions). They process it to generate
          a reply under their own privacy terms.
        </li>
        <li>
          <strong>Robinhood Chain RPC providers</strong> receive your wallet address when the app
          reads balances and history.
        </li>
        <li>
          <strong>Cloudflare</strong> hosts the app and handles its network traffic, including
          standard request logs (such as IP address and browser type) used for security and
          debugging.
        </li>
      </ul>
      <p>We never sell your data or share it for advertising.</p>

      <h2>Your choices</h2>
      <ul>
        <li>You can rename or delete contacts, categories and notes at any time in the app.</li>
        <li>You can disconnect at any time, which ends your session.</li>
        <li>
          To have everything stored for your wallet deleted,{" "}
          <a
            href="https://github.com/GTA-agency/grandtransfer_agency/issues"
            rel="noreferrer noopener"
          >
            open an issue on GitHub
          </a>{" "}
          and sign a message with that wallet to prove it&apos;s yours. Transactions themselves stay
          on the public blockchain; nobody can remove them.
        </li>
      </ul>

      <h2>Changes</h2>
      <p>
        If this policy changes, the date at the top will change with it. Significant changes will be
        announced on the site.
      </p>
    </LegalPage>
  );
}
