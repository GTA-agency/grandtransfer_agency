/**
 * Smoke test: checks every configured RPC, then connects through the fallback client
 * and prints the chain ID and latest block number.
 *
 *   pnpm smoke
 */
import { createPublicClient, http } from "viem";
import {
  assertRobinhoodChain,
  createChainClient,
  loadConfigFromEnv,
  robinhoodChain,
} from "../src/index.ts";

const config = loadConfigFromEnv();

console.log("Checking RPC endpoints...");
for (const url of config.rpcUrls) {
  const single = createPublicClient({
    chain: robinhoodChain,
    transport: http(url, { timeout: 10_000, retryCount: 0 }),
  });
  const started = Date.now();
  try {
    const [id, block] = await Promise.all([single.getChainId(), single.getBlockNumber()]);
    console.log(`  OK    ${url}  chain=${id}  block=${block}  ${Date.now() - started}ms`);
  } catch (err) {
    const reason = err instanceof Error ? (err.message.split("\n")[0] ?? err.message) : String(err);
    console.log(`  FAIL  ${url}  ${reason}`);
  }
}

const client = createChainClient(config.rpcUrls);
const chainId = await assertRobinhoodChain(client);
const block = await client.getBlock();
console.log("");
console.log(`Connected to Robinhood Chain (chain ID ${chainId})`);
console.log(
  `Latest block: ${block.number}  (${new Date(Number(block.timestamp) * 1000).toISOString()})`,
);
