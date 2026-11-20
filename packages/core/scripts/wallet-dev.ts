/**
 * Dev helper for phase 2. The real CLI comes in phase 5.
 *
 *   pnpm wallet create        create a new wallet (shows the recovery phrase once)
 *   pnpm wallet import-key    import from a private key
 *   pnpm wallet import-phrase import from a recovery phrase
 *   pnpm wallet address       show the wallet address
 *   pnpm wallet balance       show the ETH balance on Robinhood Chain
 */
import {
  VaultError,
  WalletVault,
  assertRobinhoodChain,
  createChainClient,
  explorerAddressUrl,
  formatEth,
  loadConfigFromEnv,
} from "../src/index.ts";
import { askHidden, closePrompts } from "./prompt.ts";

const config = loadConfigFromEnv();
const vault = new WalletVault(config.dataDir);
const command = process.argv[2];

async function newPassword(): Promise<string> {
  const a = await askHidden("New wallet password (min 8 characters): ");
  const b = await askHidden("Repeat password: ");
  if (a !== b) throw new Error("Passwords don't match.");
  return a;
}

async function main() {
  switch (command) {
    case "create": {
      const { address, mnemonic } = await vault.create(await newPassword());
      console.log(`\nWallet created: ${address}`);
      console.log(`Keystore: ${vault.keystorePath}\n`);
      console.log("RECOVERY PHRASE — write it down on paper and keep it offline.");
      console.log("Anyone with these words can take your funds. It will NOT be shown again.\n");
      console.log(`  ${mnemonic}\n`);
      break;
    }
    case "import-key": {
      const key = await askHidden("Private key: ");
      const { address } = await vault.importPrivateKey(key, await newPassword());
      console.log(`\nWallet imported: ${address}`);
      break;
    }
    case "import-phrase": {
      const phrase = await askHidden("Recovery phrase: ");
      const { address } = await vault.importMnemonic(phrase, await newPassword());
      console.log(`\nWallet imported: ${address}`);
      break;
    }
    case "address": {
      console.log(vault.address);
      console.log(explorerAddressUrl(vault.address));
      break;
    }
    case "balance": {
      const client = createChainClient(config.rpcUrls);
      await assertRobinhoodChain(client);
      const wei = await client.getBalance({ address: vault.address });
      console.log(`${vault.address}\n${formatEth(wei)} ETH on Robinhood Chain`);
      break;
    }
    default:
      console.log("Usage: pnpm wallet <create|import-key|import-phrase|address|balance>");
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(
      err instanceof VaultError || err instanceof Error ? `Error: ${err.message}` : err,
    );
    process.exitCode = 1;
  })
  .finally(closePrompts);
