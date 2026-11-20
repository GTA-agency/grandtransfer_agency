/**
 * Sign-In with Ethereum (EIP-4361). Wallets recognise this format, check that `domain` is the
 * site that asked, and show a clear "sign in" request instead of an unknown-signature warning.
 */
import type { Address } from "viem";
import {
  createSiweMessage,
  generateSiweNonce,
  parseSiweMessage,
  validateSiweMessage,
} from "viem/siwe";
import { ROBINHOOD_CHAIN_ID } from "@gta/core/chain";

export const SIGN_IN_STATEMENT =
  "Sign in to Grand Transfer Agent. This is free: it does not send a transaction or give access to your funds.";

export const SIGN_IN_TTL_MS = 5 * 60_000;

export function buildSignInMessage(opts: {
  address: Address;
  /** The site's own origin, e.g. https://grand-transfer-agent.autora.workers.dev */
  origin: URL;
  now?: number;
  nonce?: string;
}): { message: string; expiresAt: number } {
  const now = opts.now ?? Date.now();
  const expiresAt = now + SIGN_IN_TTL_MS;
  const message = createSiweMessage({
    domain: opts.origin.host,
    address: opts.address,
    statement: SIGN_IN_STATEMENT,
    uri: opts.origin.origin,
    version: "1",
    chainId: ROBINHOOD_CHAIN_ID,
    nonce: opts.nonce ?? generateSiweNonce(),
    issuedAt: new Date(now),
    expirationTime: new Date(expiresAt),
  });
  return { message, expiresAt };
}

/** Re-reads a message we issued and checks it is for this wallet, this site, this chain, and still valid. */
export function checkSignInMessage(
  message: string,
  expected: { address: Address; origin: URL; now?: number },
): boolean {
  const parsed = parseSiweMessage(message);
  return (
    parsed.chainId === ROBINHOOD_CHAIN_ID &&
    parsed.uri === expected.origin.origin &&
    validateSiweMessage({
      message: parsed,
      address: expected.address,
      domain: expected.origin.host,
      time: new Date(expected.now ?? Date.now()),
    })
  );
}
