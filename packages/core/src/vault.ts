import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decryptKeystoreJson, encryptKeystoreJson } from "ethers";
import { getAddress, toHex, type Address, type Hex, type LocalAccount } from "viem";
import {
  english,
  generateMnemonic,
  generatePrivateKey,
  mnemonicToAccount,
  privateKeyToAccount,
} from "viem/accounts";

export type VaultErrorCode =
  "NO_WALLET" | "WALLET_EXISTS" | "WRONG_PASSWORD" | "WEAK_PASSWORD" | "INVALID_KEY" | "LOCKED";

export class VaultError extends Error {
  constructor(
    public readonly code: VaultErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

export interface VaultOptions {
  /** Lock automatically after this many ms without use. Default 5 minutes. */
  idleTimeoutMs?: number;
  /** scrypt cost. Default N=131072 (standard). Tests may lower it. */
  scrypt?: { N: number; r: number; p: number };
}

const MIN_PASSWORD_LENGTH = 8;

/**
 * The internal wallet: one private key, stored on disk only as an encrypted
 * Web3 Secret Storage keystore (scrypt + AES-128-CTR). The decrypted key lives in memory
 * only while unlocked and is dropped on lock() or after the idle timeout.
 */
export class WalletVault {
  readonly keystorePath: string;
  private account: LocalAccount | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private readonly idleTimeoutMs: number;
  private readonly scrypt: { N: number; r: number; p: number } | undefined;

  constructor(
    private readonly dataDir: string,
    options: VaultOptions = {},
  ) {
    this.keystorePath = join(dataDir, "keystore.json");
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
    this.scrypt = options.scrypt;
  }

  exists(): boolean {
    return existsSync(this.keystorePath);
  }

  /** The wallet address, readable without unlocking. */
  get address(): Address {
    if (!this.exists())
      throw new VaultError("NO_WALLET", "No wallet yet. Create or import one first.");
    const json = JSON.parse(readFileSync(this.keystorePath, "utf8")) as { address?: string };
    if (!json.address) throw new VaultError("INVALID_KEY", "Keystore file has no address.");
    return getAddress(json.address.startsWith("0x") ? json.address : `0x${json.address}`);
  }

  /** Create a brand-new wallet. Returns the mnemonic ONCE — it is not stored anywhere. */
  async create(password: string): Promise<{ address: Address; mnemonic: string }> {
    const mnemonic = generateMnemonic(english);
    const { address } = await this.importMnemonic(mnemonic, password);
    return { address, mnemonic };
  }

  async importMnemonic(mnemonic: string, password: string): Promise<{ address: Address }> {
    let privateKey: Hex;
    try {
      const hd = mnemonicToAccount(mnemonic.trim().toLowerCase().split(/\s+/).join(" "));
      const raw = hd.getHdKey().privateKey;
      if (!raw) throw new Error("no key");
      privateKey = toHex(raw);
    } catch {
      throw new VaultError("INVALID_KEY", "That recovery phrase is not valid.");
    }
    return this.importPrivateKey(privateKey, password);
  }

  async importPrivateKey(privateKey: string, password: string): Promise<{ address: Address }> {
    this.assertPassword(password);
    if (this.exists()) {
      throw new VaultError("WALLET_EXISTS", "A wallet already exists. Refusing to overwrite it.");
    }
    const pk = (
      privateKey.trim().startsWith("0x") ? privateKey.trim() : `0x${privateKey.trim()}`
    ) as Hex;
    let account: LocalAccount;
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("format");
      account = privateKeyToAccount(pk);
    } catch {
      throw new VaultError("INVALID_KEY", "That private key is not valid.");
    }
    const json = await encryptKeystoreJson(
      { address: account.address, privateKey: pk },
      password,
      this.scrypt ? { scrypt: this.scrypt } : {},
    );
    this.writeKeystore(json);
    return { address: account.address };
  }

  async unlock(password: string): Promise<Address> {
    if (!this.exists())
      throw new VaultError("NO_WALLET", "No wallet yet. Create or import one first.");
    let decrypted: { privateKey: string };
    try {
      decrypted = await decryptKeystoreJson(readFileSync(this.keystorePath, "utf8"), password);
    } catch {
      throw new VaultError("WRONG_PASSWORD", "Wrong password.");
    }
    this.account = privateKeyToAccount(decrypted.privateKey as Hex);
    this.touch();
    return this.account.address;
  }

  lock(): void {
    this.account = undefined;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  isUnlocked(): boolean {
    return this.account !== undefined;
  }

  /** The signing account. Throws LOCKED unless unlocked. Resets the idle timer. */
  getAccount(): LocalAccount {
    if (!this.account)
      throw new VaultError("LOCKED", "Wallet is locked. Unlock it with your password.");
    this.touch();
    return this.account;
  }

  /** For callers that need a fresh random key without touching disk (tests, tooling). */
  static randomPrivateKey(): Hex {
    return generatePrivateKey();
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.lock(), this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private assertPassword(password: string): void {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new VaultError(
        "WEAK_PASSWORD",
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
  }

  private writeKeystore(json: string): void {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${this.keystorePath}.tmp`;
    writeFileSync(tmp, json, { mode: 0o600 });
    renameSync(tmp, this.keystorePath);
    chmodSync(this.keystorePath, 0o600);
  }
}
