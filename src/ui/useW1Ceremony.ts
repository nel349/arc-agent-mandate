import { useCallback, useState } from "react";
import type { Address } from "viem";
import { connectArcAccount, WebAuthnMode, type ArcAccount } from "../arc/account.ts";
import { balanceOf, sendUsdc, waitForSend } from "../arc/send.ts";
import { Usdc } from "../arc/usdc.ts";

/** The W1 flow, kept out of the view so the screen renders and does nothing else. */
export function useW1Ceremony() {
  const [account, setAccount] = useState<ArcAccount | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Every line goes to the screen AND to console. The screen is for whoever is holding the
  // phone; the console is what reaches Metro, and a failure that only exists on the screen
  // cannot be read by anyone not standing next to the device.
  const say = useCallback((line: string) => {
    console.log(`[w1] ${line}`);
    setLog((previous) => [...previous, `${new Date().toISOString().slice(11, 19)}  ${line}`]);
  }, []);

  /** Every step reports failure the same way; an unlabelled throw in a harness is wasted. */
  const step = useCallback(async (what: string, run: () => Promise<void>) => {
    setBusy(true);
    say(`${what} …`);
    try {
      await run();
    } catch (error) {
      say(`✗ ${what}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.cause) say(`   cause: ${String(error.cause)}`);
      // The screen truncates and drops structure. Dump the whole thing to console so the
      // details that actually identify a bundler or paymaster rejection survive.
      console.error(`[w1] ${what} FAILED`, error);
      const detail = error as { details?: unknown; metaMessages?: unknown; shortMessage?: unknown; cause?: unknown };
      if (detail.shortMessage) console.error("[w1]   shortMessage:", detail.shortMessage);
      if (detail.details) console.error("[w1]   details:", detail.details);
      if (detail.metaMessages) console.error("[w1]   metaMessages:", detail.metaMessages);
      if (detail.cause) console.error("[w1]   cause:", detail.cause);
    } finally {
      setBusy(false);
    }
  }, [say]);

  const config = {
    clientKey: process.env.EXPO_PUBLIC_CIRCLE_CLIENT_KEY ?? "",
    clientUrl: process.env.EXPO_PUBLIC_CIRCLE_CLIENT_URL ?? "",
    passkeyDomain: process.env.EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN ?? "kuiralabs.github.io",
  };

  /** Mints a NEW passkey, and therefore a new account. Use `signIn` to return to an old one. */
  const connect = useCallback(() => step("register NEW passkey + create account", async () => {
    const next = await connectArcAccount(
      { ...config, username: `arc-${Date.now()}` },
      WebAuthnMode.Register,
    );
    setAccount(next);
    say(`✓ account ${next.address}`);
  }), [step, say]);

  /**
   * Signs in with a passkey already on the device.
   *
   * The account is derived from the credential, not from anything this app stored — so an
   * account created earlier is never lost while its passkey is in the keychain. Passing no
   * credential id makes it a discoverable-credential request, so iOS shows every passkey for
   * this relying party and the user picks. Registration requires `residentKey: required`
   * precisely so this works.
   */
  const signIn = useCallback(() => step("sign in with an existing passkey", async () => {
    const next = await connectArcAccount(
      { ...config, username: "" },
      WebAuthnMode.Login,
    );
    setAccount(next);
    say(`✓ recovered account ${next.address}`);
  }), [step, say]);

  const refresh = useCallback(() => step("read balance from Arc", async () => {
    if (!account) throw new Error("no account yet");
    const amount = await balanceOf(account.address);
    setBalance(amount.toString());
    say(`✓ ${amount}${amount.hasErc20Dust() ? "  (has sub-cent dust the ERC-20 view cannot see)" : ""}`);
  }), [account, step, say]);

  const send = useCallback((to: string) => step("send 0.01 USDC, gasless", async () => {
    if (!account) throw new Error("no account yet");
    const userOpHash = await sendUsdc(account, { to: to as Address, amount: Usdc.parse("0.01") });
    say(`  userOp ${userOpHash}`);
    const txHash = await waitForSend(account, userOpHash);
    say(`✓ final ${txHash}`);
  }), [account, step, say]);

  return { log, busy, address: account?.address ?? null, balance, connect, signIn, refresh, send };
}
