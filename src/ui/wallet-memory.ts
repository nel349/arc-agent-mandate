import { isAddress, isHex, type Address, type Hex } from "viem";

/**
 * The wallet the phone remembers between launches, and what to do when the app opens.
 *
 * The wallet used to live only in memory, so every kill and every reinstall asked for the passkey
 * again. A passkey wallet does not need that: the wallet is derived from the passkey's credential
 * id and public key, and **both are public**. The private key never leaves the Secure Enclave, so
 * nothing here can spend; Face ID is still asked for every signature. Remembering the public half
 * only spares the ceremony of looking the wallet up again.
 *
 * Pure, so the rules are tested without a device. Where it is kept is `wallet-memory-store.ts`.
 */

/** What reopens a wallet without a passkey ceremony. Every field is public. */
export interface WalletMemory {
  /** The passkey's credential id, base64url, as the relying party knows it. */
  readonly credentialId: string;
  /** The passkey's public key, in the form viem's WebAuthn account takes it. */
  readonly publicKey: Hex;
  /** The wallet it opens, kept so a reopened wallet can be checked to be the same one. */
  readonly address: Address;
}

/** Where the remembered wallet is kept, as one JSON value, when the Keychain is not available. */
export const WALLET_MEMORY_KEY = "arc.wallet";

/**
 * Set by signing out, cleared by signing in.
 *
 * Signing out is a choice to stand at the door. Without this, the next launch would find nothing
 * remembered and offer the passkey straight back, walking the person in again uninvited.
 */
export const SIGNED_OUT_KEY = "arc.wallet.signedOut";

/** A P-256 public key is 33 bytes compressed and 65 uncompressed; anything shorter is not one. */
const MIN_PUBLIC_KEY_HEX = 2 + 33 * 2;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The public half of a connected account, as it will be remembered. */
export function walletMemoryOf(account: {
  readonly address: Address;
  readonly credential: { readonly id: string; readonly publicKey: Hex };
}): WalletMemory {
  return { credentialId: account.credential.id, publicKey: account.credential.publicKey, address: account.address };
}

export function serializeWalletMemory(memory: WalletMemory): string {
  return JSON.stringify({ credentialId: memory.credentialId, publicKey: memory.publicKey, address: memory.address });
}

/**
 * The stored value, or nothing.
 *
 * Strict where the preference parsers are tolerant, because this one opens a wallet: a value that is
 * not exactly a credential id, a public key and an address is no memory at all, and the person signs
 * in with their passkey instead. Empty is how a cleared value reads back.
 */
export function parseWalletMemory(stored: string | null): WalletMemory | null {
  if (stored === null || stored === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { credentialId, publicKey, address } = parsed as Record<string, unknown>;

  if (typeof credentialId !== "string" || !BASE64URL.test(credentialId)) return null;
  if (typeof publicKey !== "string" || !isHex(publicKey, { strict: true })) return null;
  if (publicKey.length < MIN_PUBLIC_KEY_HEX || publicKey.length % 2 !== 0) return null;
  if (typeof address !== "string" || !isAddress(address, { strict: false })) return null;
  return { credentialId, publicKey, address };
}

/**
 * Is the wallet that reopened the one that was remembered?
 *
 * The address is derived again from the credential on every reopen. If it ever comes out
 * different, the memory describes some other wallet, and opening it quietly would show a person
 * money that is not the money they left.
 */
export function isSameWallet(memory: WalletMemory, reopened: Address): boolean {
  return memory.address.toLowerCase() === reopened.toLowerCase();
}

/**
 * What the app does when it opens.
 *
 * - **reopen**: a wallet is remembered, so it opens with no ceremony at all.
 * - **offer-passkey**: nothing remembered, which after a reinstall is the ordinary case. iOS is
 *   asked for its returning-user sheet, which appears only if a passkey for this app is already on
 *   the phone, so a new person never sees an empty prompt.
 * - **welcome**: the two buttons, as before.
 */
export type LaunchPlan = "reopen" | "offer-passkey" | "welcome";

export function launchPlan(input: {
  readonly memory: WalletMemory | null;
  readonly signedOutOnPurpose: boolean;
  readonly canOfferPasskey: boolean;
}): LaunchPlan {
  if (input.memory !== null) return "reopen";
  if (input.signedOutOnPurpose) return "welcome";
  return input.canOfferPasskey ? "offer-passkey" : "welcome";
}
