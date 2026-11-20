import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const publicOrigin = process.env.GTA_PUBLIC_ORIGIN?.trim();
const https = publicOrigin?.startsWith("https://") ?? false;

/** The browser talks to: this site, the Robinhood Chain RPCs (wallet reads), nothing else. */
const RPC_ORIGINS = [
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.drpc.org",
  "https://rpc.mainnet.chain.robinhood.com",
];

const csp = [
  "default-src 'self'",
  // Next.js inlines its bootstrap scripts; dev mode also needs eval for fast refresh.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${RPC_ORIGINS.join(" ")}${isProd ? "" : " ws: wss:"}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(https ? ["upgrade-insecure-requests"] : []),
].join("; ");

const config: NextConfig = {
  // @gta/core ships TypeScript source.
  transpilePackages: ["@gta/core"],
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(https
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default config;
