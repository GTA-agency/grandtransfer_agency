# Deploying the public web app

Run the web app for other people. Visitors sign in with their own browser wallet (Bitget Wallet, MetaMask…), and each wallet only ever sees its own crew, categories, notes and books. The server never holds a private key.

> The AI runs on **your** OpenRouter key. Keep the daily quotas on, or a busy day could spend your credit.

## What public mode changes

|                 | Local (default)                | Public (`GTA_PUBLIC_MODE=true`)                                       |
| --------------- | ------------------------------ | --------------------------------------------------------------------- |
| Who can connect | This computer only (127.0.0.1) | Anyone, at `GTA_PUBLIC_ORIGIN` only                                   |
| Data            | One shared owner, like the CLI | Separate per wallet address                                           |
| AI quota        | Unlimited                      | 30 messages per wallet per day, $3 per day in total (both adjustable) |
| Cookie          | `gta_session`                  | `__Host-gta_session`: Secure, httpOnly, SameSite=Strict               |
| HTTPS           | —                              | Required. HSTS is sent automatically.                                 |

These apply in both modes:

- **Rate limits** on sign-in, chat, plans and sync.
- **Content-Security-Policy** in production. The browser may only connect to the site itself and the Robinhood Chain RPCs.
- **Host / Origin / JSON checks** on every API call.

## Settings (`.env.public`)

Start from `.env.example`, then set:

```ini
OPENROUTER_API_KEY=sk-or-…
OPENROUTER_MODEL=anthropic/claude-haiku-5.5   # cheaper for a public site
GTA_PUBLIC_MODE=true
GTA_PUBLIC_ORIGIN=https://gta.example.com     # exactly the address people type, no path
GTA_TRUST_PROXY=true                          # behind Caddy/nginx, for per-IP rate limits
AI_MESSAGES_PER_WALLET_DAY=30
AI_DAILY_BUDGET_USD=3
MAX_TX_ETH=0.05
MAX_DAILY_ETH=0.2
```

`DATA_DIR` is `/data` inside the container. Keep that volume backed up: it holds contacts, notes and the AI usage counters, but no keys.

## On Cloudflare Workers (current deployment)

Live at **https://grandtransfer.agency** (domain bought at Dynadot, DNS on Cloudflare). `www.grandtransfer.agency` and the old `grand-transfer-agent.autora.workers.dev` redirect there with a 308. Nothing runs on your computer.

How it fits together:

- **Pages:** the Next.js app, built by OpenNext.
- **`/api/*`:** handled by one Durable Object (`GtaHub`, see `apps/web/worker.ts`). The whole API runs there, next to its SQLite storage. The worker forwards `/api` to it before Next.js sees the request.
- **Settings:** non-secret settings live in `apps/web/wrangler.jsonc` under `vars`. `OPENROUTER_API_KEY` is a Worker secret.

Deploy or update from `apps/web`. The token comes from the macOS Keychain entry `cloudflare-api-token` and lives only for that command:

```bash
cd apps/web
export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-api-token -w)
export CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>
pnpm cf:deploy                                      # OpenNext build + wrangler deploy
# first time only, or to rotate the AI key:
sed -n 's/^OPENROUTER_API_KEY=//p' ../../.env | tr -d '\n' | npx wrangler secret put OPENROUTER_API_KEY
```

Free-plan notes:

- A Worker invocation may make about 50 outgoing requests. The ledger sync therefore runs in chunks of at most 40 RPC calls, and the web app keeps calling it until it's done.
- Sessions and data persist in the Durable Object's storage. Chat history and open plans are held in memory and reset if the object restarts.
- The domain is set in three places that must agree: `routes` (custom domains) and `vars.GTA_PUBLIC_ORIGIN` / `vars.CANONICAL_HOST` in `wrangler.jsonc`, and the `cf:build` script in `package.json`. Sign-in messages and the session cookie are bound to `GTA_PUBLIC_ORIGIN`.

## With Docker Compose and Caddy (any VPS)

Caddy obtains and renews the HTTPS certificate for you.

1. Get a small Linux server (1 vCPU / 1 GB is plenty) with Docker installed.
2. Point your domain's DNS **A/AAAA** record at the server, and open ports 80 and 443.
3. Copy the repository to the server and create `.env.public` in its root, as above.
4. Start it:

   ```bash
   cd deploy
   GTA_DOMAIN=gta.example.com docker compose up -d --build
   ```

5. Check it:

   ```bash
   curl -fsS https://gta.example.com/api/health     # {"ok":true,…}
   ```

The app container listens only inside the Docker network. Caddy is the only thing exposed.

## Without Docker

```bash
pnpm install --frozen-lockfile
pnpm web:build
# Load .env.public into the environment, then:
pnpm --filter @gta/web exec next start --hostname 127.0.0.1 --port 3000
```

Put a reverse proxy (Caddy, nginx) in front of it:

- Terminate HTTPS at the proxy.
- Pass the original `Host` header through.
- Set `X-Forwarded-For` to the client IP, and replace any value the client sent.

The app answers only requests whose `Host` matches `GTA_PUBLIC_ORIGIN`.

## Before you announce it

- [ ] Open the site from a phone on mobile data. Connect a wallet, sign in, and do a tiny send.
- [ ] `curl -I https://gta.example.com` shows `strict-transport-security` and `content-security-policy`.
- [ ] Set a spending alert in your OpenRouter dashboard as a second safety net.
- [ ] Back up the data volume regularly: `docker run --rm -v deploy_gta-data:/d -v $PWD:/b alpine tar czf /b/gta-data.tgz -C /d .`
- [ ] Add your own terms and privacy notice if you serve the public. Wallet addresses, contacts and notes are stored on your server.

## Limits of this setup

- **One process.** Sessions, rate-limit counters and in-progress plans live in memory, and a restart signs everyone out. The SQLite database must sit on one server, so don't run several replicas.
- **Free public RPCs** (publicnode, dRPC) can throttle a busy site. For real traffic, set `RPC_URL` and `ARCHIVE_RPC_URL` to paid endpoints.
- **The limits are per wallet, not per person.** Someone with many wallets gets many AI quotas. The daily budget (`AI_DAILY_BUDGET_USD`) is the hard ceiling.
