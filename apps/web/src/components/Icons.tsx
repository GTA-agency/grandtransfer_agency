import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 16, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...rest,
});

export const IconArrow = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const IconSend = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12l16-8-6 16-2.5-6.5z" />
  </svg>
);
export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </svg>
);
export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
);
export const IconPencil = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconExternal = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const IconTerminal = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 8l4 4-4 4M12 17h7" />
  </svg>
);
export const IconKey = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="14" r="4" />
    <path d="M11 11l9-9M17 5l2 2M15 7l2 2" />
  </svg>
);

/** Five-point star for wanted levels (filled or outline). */
export function StarShape({ filled, size = 56 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      style={
        filled
          ? { overflow: "visible", filter: "drop-shadow(0 0 10px rgba(255,210,122,0.75))" }
          : { overflow: "visible" }
      }
    >
      <path
        d="M32 5l7.9 17.2 18.8 2.1-14 12.7 3.9 18.5L32 46.1 15.4 55.5l3.9-18.5-14-12.7 18.8-2.1z"
        fill={filled ? "#fff6e0" : "none"}
        stroke={filled ? "#fff6e0" : "rgba(246,231,193,0.55)"}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Stars({ level }: { level: number }) {
  const n = Math.max(0, Math.min(5, level));
  return (
    <span className="stars" role="img" aria-label={`Wanted level ${n} of 5`}>
      {"★".repeat(n)}
      <span className="off">{"★".repeat(5 - n)}</span>
    </span>
  );
}
