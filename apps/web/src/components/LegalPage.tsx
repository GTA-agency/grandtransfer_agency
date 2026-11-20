import type { ReactNode } from "react";

/** Plain, readable layout for the Terms and Privacy pages. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="legal shell">
      <a className="legal-home" href="/">
        <img src="/gta-mark-v2.png" alt="" width={409} height={176} />
        <span>Back to Grand Transfer Agent</span>
      </a>
      <article className="legal-card">
        <p className="eyebrow">Last updated {updated}</p>
        <h1 className="display lg">{title}</h1>
        {children}
      </article>
      <nav className="legal-links" aria-label="Legal">
        <a href="/terms">Terms of Use</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="https://github.com/GTA-agency/grandtransfer_agency" rel="noreferrer noopener">
          Source code
        </a>
      </nav>
    </main>
  );
}
