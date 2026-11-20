import { IconKey } from "./Icons";

export function Footer() {
  return (
    <footer className="footer shell">
      <img src="/logo.png" alt="" width={1378} height={1015} />
      <div className="keys-home">
        <IconKey size={22} style={{ color: "var(--pink)", flex: "none" }} />
        <span className="display">Keys stay home</span>
        <p>
          Your keys stay in your own wallet. The app and the AI only plan; your wallet signs every
          send.
        </p>
      </div>
      <p className="disclaimer">
        Grand Transfer Agent is an independent project and is not affiliated with Rockstar Games,
        Take-Two Interactive or Robinhood. Transfers on Robinhood Chain are final.
      </p>
      <nav className="legal-links" aria-label="Legal">
        <a href="/terms">Terms of Use</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="https://github.com/GTA-agency/grandtransfer_agency" rel="noreferrer noopener">
          Source code
        </a>
      </nav>
    </footer>
  );
}
