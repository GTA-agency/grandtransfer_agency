import { readFileSync, statSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VaultError, WalletVault } from "../src/index.ts";
import {
  TEST_MNEMONIC,
  TEST_MNEMONIC_ADDRESS,
  TEST_PRIVATE_KEY,
  TEST_SCRYPT,
  tempDir,
} from "./helpers.ts";

const PASSWORD = "correct horse battery";

describe("WalletVault", () => {
  it("creates a wallet, returns the mnemonic once and stores only an encrypted keystore", async () => {
    const dir = tempDir();
    const vault = new WalletVault(dir, { scrypt: TEST_SCRYPT });
    const { address, mnemonic } = await vault.create(PASSWORD);

    expect(mnemonic.split(" ")).toHaveLength(12);
    expect(vault.address).toBe(address);
    const file = readFileSync(vault.keystorePath, "utf8");
    expect(file).not.toContain(mnemonic);
    const keystore = JSON.parse(file);
    // Web3 Secret Storage allows "crypto" or "Crypto" (ethers writes the latter).
    expect((keystore.crypto ?? keystore.Crypto).kdf).toBe("scrypt");
    expect(statSync(vault.keystorePath).mode & 0o777).toBe(0o600);
    expect(vault.isUnlocked()).toBe(false);
  });

  it("imports the standard test mnemonic to the expected address", async () => {
    const vault = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
    const { address } = await vault.importMnemonic(TEST_MNEMONIC, PASSWORD);
    expect(address).toBe(TEST_MNEMONIC_ADDRESS);
  });

  it("imports a private key with or without 0x", async () => {
    const a = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
    const b = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
    expect((await a.importPrivateKey(TEST_PRIVATE_KEY, PASSWORD)).address).toBe(
      TEST_MNEMONIC_ADDRESS,
    );
    expect((await b.importPrivateKey(TEST_PRIVATE_KEY.slice(2), PASSWORD)).address).toBe(
      TEST_MNEMONIC_ADDRESS,
    );
  });

  it("does not keep the private key in plain text on disk", async () => {
    const vault = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
    await vault.importPrivateKey(TEST_PRIVATE_KEY, PASSWORD);
    expect(readFileSync(vault.keystorePath, "utf8")).not.toContain(TEST_PRIVATE_KEY.slice(2));
  });

  it("refuses to overwrite an existing wallet", async () => {
    const vault = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
    await vault.importPrivateKey(TEST_PRIVATE_KEY, PASSWORD);
    await expect(vault.create(PASSWORD)).rejects.toMatchObject({ code: "WALLET_EXISTS" });
  });

  it("rejects weak passwords and invalid keys", async () => {
    const vault = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
    await expect(vault.create("short")).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(vault.importPrivateKey("0x1234", PASSWORD)).rejects.toMatchObject({
      code: "INVALID_KEY",
    });
    await expect(vault.importMnemonic("not a real phrase", PASSWORD)).rejects.toMatchObject({
      code: "INVALID_KEY",
    });
  });

  it("unlocks only with the right password and locks again", async () => {
    const vault = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
    await vault.importPrivateKey(TEST_PRIVATE_KEY, PASSWORD);

    await expect(vault.unlock("wrong password!")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    expect(() => vault.getAccount()).toThrow(VaultError);

    await vault.unlock(PASSWORD);
    expect(vault.getAccount().address).toBe(TEST_MNEMONIC_ADDRESS);
    vault.lock();
    expect(vault.isUnlocked()).toBe(false);
    expect(() => vault.getAccount()).toThrow(/locked/i);
  });

  it("auto-locks after the idle timeout", async () => {
    const vault = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT, idleTimeoutMs: 1000 });
    await vault.importPrivateKey(TEST_PRIVATE_KEY, PASSWORD);
    await vault.unlock(PASSWORD);
    vi.useFakeTimers();
    try {
      vault.getAccount(); // resets the timer under fake time
      vi.advanceTimersByTime(999);
      expect(vault.isUnlocked()).toBe(true);
      vi.advanceTimersByTime(2);
      expect(vault.isUnlocked()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports NO_WALLET before anything exists", async () => {
    const vault = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
    expect(vault.exists()).toBe(false);
    expect(() => vault.address).toThrow(VaultError);
    await expect(vault.unlock(PASSWORD)).rejects.toMatchObject({ code: "NO_WALLET" });
  });
});
