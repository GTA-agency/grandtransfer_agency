import { GTA_TOKEN } from "@gta/core/chain";

/**
 * The official $GTA contract address. Empty means "coming soon"; setting it switches
 * /token to the live page. It is a constant on purpose: the address shown there must never
 * come from a URL, a request or anything else a visitor can influence.
 */
export const TOKEN_CA: string = GTA_TOKEN.address;

if (TOKEN_CA !== "" && !/^0x[a-fA-F0-9]{40}$/.test(TOKEN_CA)) {
  throw new Error("TOKEN_CA is not a valid contract address");
}

export const TOKEN_LIVE = TOKEN_CA !== "";
export const TOKEN_EXPLORER_URL = `https://robinhoodchain.blockscout.com/token/${TOKEN_CA}`;
