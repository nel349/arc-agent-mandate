import { useCallback, useState } from "react";
import { connectArcAccount, WebAuthnMode, type ArcAccount } from "../arc/account.ts";
import { balanceOf } from "../arc/send.ts";
import { Usdc } from "../arc/usdc.ts";

/**
 * The wallet: creating one, returning to one, and what it holds.
 *
 * Pulled out of the W1 harness so the product screen and the harness share one account rather
 * than each opening their own — two passkey ceremonies for one wallet would be a confusing thing
 * to put in front of a person.
 */

export const CIRCLE_CONFIG = {
  clientKey: process.env.EXPO_PUBLIC_CIRCLE_CLIENT_KEY ?? "",
  clientUrl: process.env.EXPO_PUBLIC_CIRCLE_CLIENT_URL ?? "",
  passkeyDomain: process.env.EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN ?? "",
} as const;

export interface ArcWallet {
  readonly account: ArcAccount | null;
  readonly balance: Usdc | null;
  readonly busy: boolean;
  readonly error: string | null;
  /** Mints a NEW passkey, and therefore a new wallet. */
  create(): void;
  /**
   * Returns to a wallet whose passkey is already on the device.
   *
   * The wallet is derived from the credential rather than from anything stored here, so it is
   * never lost while the passkey is in the keychain. Passing no credential id lets the OS show
   * every passkey for this relying party and let the person choose.
   */
  signIn(): void;
  refresh(): void;
}

export function useArcAccount(): ArcWallet {
  const [account, setAccount] = useState<ArcAccount | null>(null);
  const [balance, setBalance] = useState<Usdc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((what: string, work: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        await work();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        // The screen flattens structure away; the console is where a bundler or paymaster
        // rejection stays readable.
        console.error(`[wallet] ${what} failed`, cause);
      } finally {
        setBusy(false);
      }
    })();
  }, [busy]);

  const load = useCallback(async (next: ArcAccount) => {
    setAccount(next);
    setBalance(await balanceOf(next.address));
  }, []);

  const create = useCallback(() => run("create wallet", async () => {
    await load(await connectArcAccount(
      { ...CIRCLE_CONFIG, username: `arc-${Date.now()}` }, WebAuthnMode.Register,
    ));
  }), [run, load]);

  const signIn = useCallback(() => run("sign in", async () => {
    await load(await connectArcAccount({ ...CIRCLE_CONFIG, username: "" }, WebAuthnMode.Login));
  }), [run, load]);

  const refresh = useCallback(() => run("read balance", async () => {
    if (!account) throw new Error("no wallet yet");
    setBalance(await balanceOf(account.address));
  }), [account, run]);

  return { account, balance, busy, error, create, signIn, refresh };
}
