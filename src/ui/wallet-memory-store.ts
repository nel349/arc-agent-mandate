import { Platform } from "react-native";
import { arcPasskey } from "@passkey-native";
import { readPreference, writePreference } from "./preference-store.ts";
import {
  parseWalletMemory, serializeWalletMemory, SIGNED_OUT_KEY, WALLET_MEMORY_KEY, type WalletMemory,
} from "./wallet-memory.ts";

/**
 * Where the remembered wallet is kept: every read and write of it goes through here.
 *
 * The iOS Keychain first, through the app's own passkey module, because Keychain items usually
 * outlive the app, so a reinstall on the same phone reopens the wallet. The app's own storage
 * (`preference-store.ts`) otherwise: a build on the phone that predates the Keychain functions
 * still remembers the wallet across a kill and a restart, just not across a reinstall.
 *
 * Nothing kept here is secret. See `wallet-memory.ts` for what it holds and why that is safe.
 */

/** True when the build on the phone has the Keychain functions. Checked every time, not cached. */
function hasVault(): boolean {
  return Platform.OS === "ios"
    && typeof arcPasskey.saveWalletMemory === "function"
    && typeof arcPasskey.loadWalletMemory === "function"
    && typeof arcPasskey.clearWalletMemory === "function";
}

export async function loadWalletMemory(): Promise<WalletMemory | null> {
  if (hasVault()) {
    try {
      const kept = parseWalletMemory((await arcPasskey.loadWalletMemory?.()) ?? null);
      if (kept !== null) return kept;
    } catch (cause) {
      console.warn("[wallet] the Keychain could not be read; trying the app's own storage", cause);
    }
  }
  // An older build, or a wallet remembered before the build on the phone had the Keychain.
  return parseWalletMemory(await readPreference(WALLET_MEMORY_KEY));
}

export async function saveWalletMemory(memory: WalletMemory): Promise<void> {
  const value = serializeWalletMemory(memory);
  if (hasVault()) {
    try {
      await arcPasskey.saveWalletMemory?.(value);
      // One copy, in the place that outlives a reinstall. An older copy in the app's storage would
      // otherwise outlast a sign-out done on a build without the Keychain.
      await writePreference(WALLET_MEMORY_KEY, "");
      return;
    } catch (cause) {
      console.warn("[wallet] the Keychain refused the wallet; keeping it in the app's own storage", cause);
    }
  }
  await writePreference(WALLET_MEMORY_KEY, value);
}

export async function clearWalletMemory(): Promise<void> {
  if (hasVault()) {
    try {
      await arcPasskey.clearWalletMemory?.();
    } catch (cause) {
      console.warn("[wallet] the Keychain could not forget the wallet", cause);
    }
  }
  // Empty is how a cleared value reads back; the preference store has no delete.
  await writePreference(WALLET_MEMORY_KEY, "");
}

/** Whether the person signed out on purpose, so the next launch does not sign them straight back in. */
export async function wasSignedOutOnPurpose(): Promise<boolean> {
  return (await readPreference(SIGNED_OUT_KEY)) === "1";
}

export async function rememberSignedOut(signedOut: boolean): Promise<void> {
  await writePreference(SIGNED_OUT_KEY, signedOut ? "1" : "");
}
