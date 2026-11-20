import { join } from "node:path";
import {
  AddressBook,
  DEFAULT_HOSTED_AGENT_URL,
  HostedLlmClient,
  EthUsdPrice,
  Books,
  LedgerStore,
  LedgerSync,
  OpenRouterClient,
  TransferService,
  WalletAgent,
  WalletVault,
  createChainClient,
  createFileUsageLog,
  createViemChainOps,
  createViemHistory,
  loadConfigFromEnv,
  openDatabase,
  type ChainOps,
  type Config,
  type Database,
} from "@gta/core";
import type { PublicClient } from "viem";

export interface AppContext {
  config: Config;
  db: Database;
  vault: WalletVault;
  contacts: AddressBook;
  ledger: LedgerStore;
  books: Books;
  client: PublicClient;
  chain: ChainOps;
  transfers: TransferService;
  usagePath: string;
  sync(): LedgerSync;
  /**
   * The agent. With an OpenRouter key it runs on that key; without one it uses the hosted
   * agent at grandtransfer.agency, signing in with this wallet (`unlock` prompts if needed).
   */
  agent(unlock?: () => Promise<void>): WalletAgent;
  /** True when chat runs on the hosted agent (no local OpenRouter key). */
  hosted: boolean;
  /** Current ETH/USD (display only), or undefined when no source answers quickly. */
  ethUsd(): Promise<string | undefined>;
}

export function createContext(): AppContext {
  const config = loadConfigFromEnv();
  const db = openDatabase(config.dataDir);
  const vault = new WalletVault(config.dataDir);
  const contacts = new AddressBook(db);
  const ledger = new LedgerStore(db);
  const books = new Books(db, ledger);
  const client = createChainClient(config.rpcUrls);
  const chain = createViemChainOps(client, config.rpcUrls);
  const transfers = new TransferService({
    vault,
    contacts,
    ledger,
    chain,
    limits: { maxTxWei: config.maxTxWei, maxDailyWei: config.maxDailyWei },
  });
  const usagePath = join(config.dataDir, "usage.jsonl");
  let sync: LedgerSync | undefined;
  let agent: WalletAgent | undefined;
  const price = new EthUsdPrice();
  const ethUsd = async () => (await price.get())?.usd;
  return {
    config,
    db,
    vault,
    contacts,
    ledger,
    books,
    client,
    chain,
    transfers,
    usagePath,
    ethUsd,
    sync: () =>
      (sync ??= new LedgerSync({
        db,
        ledger,
        contacts,
        history: createViemHistory(config.archiveRpcUrl),
      })),
    hosted: !config.openRouterApiKey,
    agent: (unlock) =>
      (agent ??= new WalletAgent({
        llm: config.openRouterApiKey
          ? new OpenRouterClient({ apiKey: config.openRouterApiKey, model: config.openRouterModel })
          : new HostedLlmClient({
              origin: (process.env.GTA_AGENT_URL ?? DEFAULT_HOSTED_AGENT_URL).replace(/\/$/, ""),
              address: vault.address,
              sessionFile: join(config.dataDir, "hosted-session.json"),
              getAccount: async () => {
                if (!vault.isUnlocked()) await unlock?.();
                return vault.getAccount();
              },
            }),
        model: config.openRouterApiKey ? config.openRouterModel : "hosted",
        ctx: { vault, contacts, ledger, chain, transfers, ethUsd, now: Date.now },
        usageLog: createFileUsageLog(usagePath),
      })),
  };
}
