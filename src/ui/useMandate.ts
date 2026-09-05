import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import type { ArcAccount } from "../arc/account.ts";
import {
  grantMandate, isPluginDeployed, listMandates, revokeMandate, updateMandate,
  type Mandate, type MandateTerms,
} from "../arc/mandate.ts";
import { Usdc } from "../arc/usdc.ts";
import { describeMandateFailure } from "./mandate-errors.ts";

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
  grant(terms: MandateTerms): void;
  revoke(agent: Address): void;
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
        setError(describeMandateFailure(cause));
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
  const perform = useCallback(
    (run: (account: ArcAccount) => Promise<unknown>) => {
      if (!account || busy) return;
      setError(null);
      setBusy(true);
      void (async () => {
        try {
          const userOpHash = await run(account);
          await account.bundler.waitForUserOperationReceipt({ hash: userOpHash as `0x${string}` });
          refresh();
        } catch (cause) {
          setError(describeMandateFailure(cause));
        } finally {
          setBusy(false);
        }
      })();
    },
    [account, busy, refresh],
  );

  const grant = useCallback(
    (terms: MandateTerms) => perform((a) => grantMandate(a, terms)),
    [perform],
  );

  const revoke = useCallback(
    (agent: Address) => perform((a) => revokeMandate(a, agent)),
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
      perform((a) => updateMandate(a, { agent, limit }));
    },
    [mandates, perform],
  );

  return { mandates, busy, error, ready, grant, revoke, changeLimit, refresh };
}


