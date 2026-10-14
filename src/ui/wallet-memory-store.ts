import { Platform } from "react-native";
import { arcPasskey } from "@passkey-native";
import { readPreference, writePreference } from "./preference-store.ts";
import {
  parseWalletMemory, serializeWalletMemory, signedOutKeyOf, walletMemoryKeyOf, type WalletKind, type WalletMemory,
} from "./wallet-memory.ts";

/**
 * Where the remembered wallet is kept: every read and write of it goes through here.
 *
 * The iOS Keychain first, through the app's own passkey module, because Keychain items usually
 * outlive the app, so a reinstall on the same phone reopens the wallet. The app's own storage
 * (`preference-store.ts`) otherwise: a build on the phone that predates the Keychain functions
 * still remembers the wallet across a kill and a restart, just not across a reinstall.
 *
 * Each kind of money has its own wallet, so each is kept on its own (`WalletKind`). The Keychain holds
 * one value, and it holds the test wallet, which was there first; the real-money wallet is kept in the
 * app's own storage. On the web, where the wallet lives today, that is where both are kept anyway.
 *
 * Nothing kept here is secret. See `wallet-memory.ts` for what it holds and why that is safe.
 */

/** True when the build on the phone has the Keychain functions and the kind is the one kept there. Checked every time, not cached. */
function hasVault(kind: WalletKind): boolean {
  return kind === "test"
    && Platform.OS === "ios"
    && typeof arcPasskey.saveWalletMemory === "function"
    && typeof arcPasskey.loadWalletMemory === "function"
    && typeof arcPasskey.clearWalletMemory === "function";
}

export async function loadWalletMemory(kind: WalletKind): Promise<WalletMemory | null> {
  if (hasVault(kind)) {
    try {
      const kept = parseWalletMemory((await arcPasskey.loadWalletMemory?.()) ?? null);
      if (kept !== null) return kept;
    } catch (cause) {
      console.warn("[wallet] the Keychain could not be read; trying the app's own storage", cause);
    }
  }
  // An older build, or a wallet remembered before the build on the phone had the Keychain.
  return parseWalletMemory(await readPreference(walletMemoryKeyOf(kind)));
}

export async function saveWalletMemory(kind: WalletKind, memory: WalletMemory): Promise<void> {
  const value = serializeWalletMemory(memory);
  if (hasVault(kind)) {
    try {
      await arcPasskey.saveWalletMemory?.(value);
      // One copy, in the place that outlives a reinstall. An older copy in the app's storage would
      // otherwise outlast a sign-out done on a build without the Keychain.
      await writePreference(walletMemoryKeyOf(kind), "");
      return;
    } catch (cause) {
      console.warn("[wallet] the Keychain refused the wallet; keeping it in the app's own storage", cause);
    }
  }
  await writePreference(walletMemoryKeyOf(kind), value);
}

export async function clearWalletMemory(kind: WalletKind): Promise<void> {
  if (hasVault(kind)) {
    try {
      await arcPasskey.clearWalletMemory?.();
    } catch (cause) {
      console.warn("[wallet] the Keychain could not forget the wallet", cause);
    }
  }
  // Empty is how a cleared value reads back; the preference store has no delete.
  await writePreference(walletMemoryKeyOf(kind), "");
}

/** Whether the person signed out on purpose, so the next launch does not sign them straight back in. */
export async function wasSignedOutOnPurpose(kind: WalletKind): Promise<boolean> {
  return (await readPreference(signedOutKeyOf(kind))) === "1";
}

export async function rememberSignedOut(kind: WalletKind, signedOut: boolean): Promise<void> {
  await writePreference(signedOutKeyOf(kind), signedOut ? "1" : "");
}
