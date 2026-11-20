// Builds the publishable npm package `grand-transfer-agent` into apps/cli/npm-dist:
// one bundled ESM file (the CLI plus @gta/core) and a package.json whose runtime
// dependencies are viem, ethers and zod at the versions this repo is tested with.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(cliDir, "../..");
const out = join(cliDir, "npm-dist");
const VERSION = process.env.GTA_VERSION ?? "0.1.0";

// Read installed versions straight from disk (some packages don't export ./package.json).
const versionOf = (name) =>
  JSON.parse(readFileSync(join(repo, "packages/core/node_modules", name, "package.json"), "utf8"))
    .version;
const deps = Object.fromEntries(["viem", "ethers", "zod"].map((d) => [d, `^${versionOf(d)}`]));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(cliDir, "src/index.ts")],
  outfile: join(out, "gta.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: Object.keys(deps),
  define: { __GTA_VERSION__: JSON.stringify(VERSION) },
  legalComments: "none",
  logLevel: "warning",
});

// The source's own shebang runs it through tsx; the published file is plain Node.
const bundlePath = join(out, "gta.mjs");
const bundled = readFileSync(bundlePath, "utf8").replace(/^#!.*\n/, "");
writeFileSync(bundlePath, `#!/usr/bin/env node\n${bundled}`, { mode: 0o755 });

const pkg = {
  name: "grand-transfer-agent",
  version: VERSION,
  description:
    "AI wallet agent for Robinhood Chain in your terminal: plan ETH transfers in plain words, confirm, and keep the books.",
  keywords: ["ai-agent", "ethereum", "wallet", "robinhood-chain", "cli", "openrouter"],
  homepage: "https://grandtransfer.agency",
  repository: { type: "git", url: "git+https://github.com/GTA-agency/grandtransfer_agency.git" },
  bugs: { url: "https://github.com/GTA-agency/grandtransfer_agency/issues" },
  license: "MIT",
  author: "GTA-agency",
  type: "module",
  bin: { gta: "gta.mjs" },
  files: ["gta.mjs", "README.md", "LICENSE"],
  engines: { node: ">=22.13" },
  dependencies: deps,
};
writeFileSync(join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
cpSync(join(cliDir, "npm/README.md"), join(out, "README.md"));
cpSync(join(repo, "LICENSE"), join(out, "LICENSE"));
console.log(`built ${pkg.name}@${VERSION} → ${out}`);
console.log("dependencies:", JSON.stringify(deps));
