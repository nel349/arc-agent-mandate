import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { connectArcAccount, WebAuthnMode, type ArcAccount } from "../arc/account.ts";
import { balanceOf } from "../arc/send.ts";
import { Usdc } from "../arc/usdc.ts";
import { describeFailure, WALLET_FAILURES } from "./failure.ts";

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

/** Arc settles in under a second, so ten is unhurried. Matches the mandate poll deliberately. */
const BALANCE_POLL_MS = 10_000;

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
  /**
   * Puts the wallet down, back to the welcome screen.
   *
   * Nothing is lost: the wallet is derived from its passkey, so signing in again, with this passkey
   * or another, returns to it. Ignored while a passkey ceremony is in flight, which would otherwise
   * land a wallet after the person had left it.
   */
  signOut(): void;
  refresh(): void;
}

export function useArcAccount(): ArcWallet {
  const [account, setAccount] = useState<ArcAccount | null>(null);
  const [balance, setBalance] = useState<Usdc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((work: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        await work();
      } catch (cause) {
        // One describer, shared with the mandate screen. This used to be a second, weaker copy:
        // it read only the outermost `message`, so a reason nested in `cause` never reached it,
        // and its cancellation check could not match what iOS actually reports — so dismissing
        // the passkey prompt showed library prose about a failed credential request.
        setError(describeFailure(cause, WALLET_FAILURES));
      } finally {
        setBusy(false);
      }
    })();
  }, [busy]);

  const load = useCallback(async (next: ArcAccount) => {
    setAccount(next);
    setBalance(await balanceOf(next.address));
  }, []);

  const create = useCallback(() => run(async () => {
    await load(await connectArcAccount(
      { ...CIRCLE_CONFIG, username: `arc-${Date.now()}` }, WebAuthnMode.Register,
    ));
  }), [run, load]);

  const signIn = useCallback(() => run(async () => {
    await load(await connectArcAccount({ ...CIRCLE_CONFIG, username: "" }, WebAuthnMode.Login));
  }), [run, load]);

  const signOut = useCallback(() => {
    if (busy) return;
    setAccount(null);
    setBalance(null);
    setError(null);
  }, [busy]);

  const refresh = useCallback(() => run(async () => {
    if (!account) throw new Error("no wallet yet");
    setBalance(await balanceOf(account.address));
  }), [account, run]);

  /**
   * The balance goes stale on its own, because an agent spends from outside this app. Polling
   * lives here rather than in the mandate hook: whoever owns a number is responsible for it being
   * true, and having two hooks read the same figure is how they end up disagreeing on screen.
   */
  useEffect(() => {
    if (!account || busy) return;
    const timer = setInterval(() => {
      void balanceOf(account.address).then(setBalance).catch(() => {
        // A missed poll is not worth a message; the next one will say the same thing or better.
      });
    }, BALANCE_POLL_MS);
    return () => clearInterval(timer);
  }, [account, busy]);

  /**
   * And again when the app returns, since the timer did not run while it was away.
   *
   * Same reason as the mandate screen's: a suspended interval is not a slow interval, it is a
   * stopped one, so the balance on screen was as old as the last time this app was open.
   */
  useEffect(() => {
    if (!account) return;
    const watch = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void balanceOf(account.address).then(setBalance).catch(() => {
        // Same as the poll: a missed read is not worth a message.
      });
    });
    return () => watch.remove();
  }, [account]);

  return { account, balance, busy, error, create, signIn, signOut, refresh };
}
