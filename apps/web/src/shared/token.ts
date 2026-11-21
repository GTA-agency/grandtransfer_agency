/**
 * The official $GTA contract address. Empty means "coming soon"; setting it switches
 * /token to the live page. It is a constant on purpose: the address shown there must never
 * come from a URL, a request or anything else a visitor can influence.
 */
export const TOKEN_CA: string = "0xc5f340e5376ae0cc00109ab78109a3218fb0d61b";

if (TOKEN_CA !== "" && !/^0x[a-fA-F0-9]{40}$/.test(TOKEN_CA)) {
  throw new Error("TOKEN_CA is not a valid contract address");
}

export const TOKEN_LIVE = TOKEN_CA !== "";
export const TOKEN_EXPLORER_URL = `https://robinhoodchain.blockscout.com/token/${TOKEN_CA}`;
