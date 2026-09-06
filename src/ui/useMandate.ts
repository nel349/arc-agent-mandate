import { useCallback, useEffect, useState } from "react";
import type { Address, Hash } from "viem";
import type { ArcAccount } from "../arc/account.ts";
import {
  grantMandate, isPluginDeployed, listMandates, revokeMandate, updateMandate,
  type Mandate, type MandateTerms,
} from "../arc/mandate.ts";
import { Usdc } from "../arc/usdc.ts";
import { describeFailure, MANDATE_FAILURES } from "./failure.ts";


declare const __DEV__: boolean;

/**
 * Granting, watching and revoking mandates, kept out of the view.
 *
 * Every figure here is **read back from the chain** rather than tracked locally. A mandate's
 * remaining balance is the one number a person decides on, and a local copy that drifts from
 * what the account will actually enforce is worse than no number at all — it would show someone
 * headroom their agent does not have.
 */

/** Slow enough to be unhurried on a chain that settles in under a second. */
const POLL_INTERVAL_MS = 10_000;

export interface MandateScreen {
  readonly mandates: readonly Mandate[];
  readonly busy: boolean;
  /** Set when the last action failed. Cleared when the next one starts. */
  readonly error: string | null;
  /**
   * Whether the allowance contract exists on this network. `null` until the first read finishes.
   *
   * Nothing can be granted without it, so the screen says so plainly rather than letting someone
   * fill in a form that cannot work.
   */
  readonly ready: boolean | null;
  /** `onGranted` runs when the operation has landed, not when it was requested. */
  grant(terms: MandateTerms, onGranted?: () => void): void;
  revoke(agent: Address, onRevoked?: () => void): void;
  changeLimit(agent: Address, limit: Usdc): void;
  refresh(): void;
}

export function useMandate(account: ArcAccount | null): MandateScreen {
  const [mandates, setMandates] = useState<readonly Mandate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    if (!account) return;
    void (async () => {
      try {
        const [deployed, live] = await Promise.all([
          isPluginDeployed(),
          listMandates(account.address),
        ]);
        setReady(deployed);
        setMandates(live);
      } catch (cause) {
        setError(describeFailure(cause, MANDATE_FAILURES));
      }
    })();
  }, [account]);

  useEffect(refresh, [refresh]);

  /**
   * Keep reading while the screen is open.
   *
   * The agent spends from outside this app, so a screen that reads once shows a number that is
   * quietly wrong the moment anything happens — the worst failure available for a figure whose
   * whole job is to be trusted. Arc settles in under a second, so ten is unhurried.
   *
   * Paused while a write is in flight: re-reading mid-grant would show the old allowance and
   * make a confirmed action look like it failed.
   */
  useEffect(() => {
    if (!account || busy) return;
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [account, busy, refresh]);

  /**
   * Every write follows the same shape: clear the last error, run, then re-read the chain.
   *
   * The re-read is the important half. A user operation is accepted by the bundler before it is
   * mined, so returning early would show a mandate that does not exist yet.
   */
  /**
   * Run one mandate operation and wait for it to land.
   *
   * `run` returns **every** hash it produced, not one: a grant is two user operations, and the
   * previous shape returned `unknown` and cast it to a hash, which both hid that and would have
   * waited on the wrong thing. The last hash is the one to wait for, because they are sequential.
   *
   * Success is announced. Only failures used to reach the console, so a grant that worked moved
   * real money and left no trace anywhere — no hash to look up, and a wallet balance that had
   * quietly gone down. The hashes are public identifiers of operations the person just authorised
   * themselves, so this is not credential-adjacent, but it stays out of release builds anyway.
   */
  const perform = useCallback(
    (
      label: string,
      run: (account: ArcAccount) => Promise<readonly Hash[]>,
      /**
       * Run only once the operation has actually landed.
       *
       * The screen used to clear its form on the line after calling this, which happens
       * immediately — before the passkey prompt, let alone the receipt. Cancelling Face ID meant
       * the address you had just scanned was already gone.
       */
      onDone?: () => void,
    ) => {
      if (!account || busy) return;
      setError(null);
      setBusy(true);
      void (async () => {
        try {
          const hashes = await run(account);
          const last = hashes[hashes.length - 1];
          if (last !== undefined) await account.bundler.waitForUserOperationReceipt({ hash: last });
          if (__DEV__) {
            console.log(`[mandate] ${label} — ${hashes.length} user operation(s)`);
            for (const hash of hashes) console.log(`[mandate]   ${hash}`);
          }
          refresh();
          onDone?.();
        } catch (cause) {
          setError(describeFailure(cause, MANDATE_FAILURES));
        } finally {
          setBusy(false);
        }
      })();
    },
    [account, busy, refresh],
  );

  const grant = useCallback(
    (terms: MandateTerms, onGranted?: () => void) =>
      perform("granted an allowance", async (a) => [(await grantMandate(a, terms)).grant], onGranted),
    [perform],
  );

  const revoke = useCallback(
    (agent: Address, onRevoked?: () => void) =>
      perform("revoked an allowance", async (a) => [await revokeMandate(a, agent)], onRevoked),
    [perform],
  );

  /**
   * Re-scoping an existing mandate. Lowering the limit below what the agent has already spent is
   * legitimate and is how you stop it without revoking — the account refuses everything further
   * while the record of what was spent stays intact.
   */
  const changeLimit = useCallback(
    (agent: Address, limit: Usdc) => {
      if (!mandates.some((m) => m.agent === agent)) {
        setError(`no mandate for ${agent}`);
        return;
      }
      perform("changed an allowance", async (a) => [await updateMandate(a, { agent, limit })]);
    },
    [mandates, perform],
  );

  return { mandates, busy, error, ready, grant, revoke, changeLimit, refresh };
}


