"use client";
import { useEffect, useState, type ReactNode } from "react";

interface Props {
  links: { href: string; label: string }[];
  actions: ReactNode;
}

/**
 * Floating glass capsule: logo, section links (the one in view is highlighted) and actions.
 * Sticky, overlapping the top of the hero; it tightens and darkens once the page scrolls.
 */
export function NavPill({ links, actions }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    const targets = links
      .map((l) => document.querySelector<HTMLElement>(l.href))
      .filter((el): el is HTMLElement => el !== null);
    if (!targets.length || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (hit) setActive(`#${hit.target.id}`);
      },
      { rootMargin: "-35% 0px -55% 0px", threshold: [0, 0.25, 0.5] },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [links]);

  return (
    <header className={`navpill-wrap${scrolled ? " scrolled" : ""}`}>
      <div className="shell">
        <div className="navpill">
          <a className="navpill-brand" href="#top" aria-label="Grand Transfer Agent, back to top">
            <img className="brand-mark" src="/gta-mark-v2.png" alt="" width={409} height={176} />
            <img
              className="brand-word"
              src="/gta-wordmark-v3.png"
              alt="Grand Transfer Agent"
              width={696}
              height={96}
            />
          </a>
          <nav className="navpill-links" aria-label="Sections">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={active === l.href ? "active" : undefined}
                aria-current={active === l.href ? "true" : undefined}
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="navpill-actions">{actions}</div>
        </div>
      </div>
    </header>
  );
}
