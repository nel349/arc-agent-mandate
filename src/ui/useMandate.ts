import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
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

/**
 * Which action is running, and for which agent.
 *
 * `busy` alone could not say, so every button bound to it spun at once: tap one of two buttons and
 * both showed a spinner, and a grant still landing in the background put a spinner on an agent's
 * Revoke that nobody had touched. A button spins when *its* action is the one running, and every
 * other button is simply unavailable until it lands.
 */
export interface PendingAction {
  readonly kind: "grant" | "revoke" | "change";
  readonly agent: Address;
}

export interface MandateScreen {
  readonly mandates: readonly Mandate[];
  /** Something is running. For whether *this* button's action is, see `pending`. */
  readonly busy: boolean;
  readonly pending: PendingAction | null;
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
  const [pending, setPending] = useState<PendingAction | null>(null);
  const busy = pending !== null;
  /**
   * Two kinds of failure, kept apart because they end differently.
   *
   * A failed **read** is over the moment a later read succeeds, so the next good poll clears it. It
   * used to share one slot with actions and was never cleared, so a single refused poll left
   * "Arc is busy" on the screen for as long as the app stayed open. A failed **action** — a grant or
   * a revoke the person asked for — stays until they try something else, because a passing poll
   * says nothing about whether the thing they asked for happened.
   */
  const [actionError, setActionError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
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
        setReadError(null);
      } catch (cause) {
        setReadError(describeFailure(cause, MANDATE_FAILURES));
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
   * Read again the moment the app comes back, because the timer above did not run while it was away.
   *
   * The interval is not a clock: the platform suspends JavaScript timers in a backgrounded app, so
   * coming back to this screen showed whatever was last read — from minutes or hours earlier — and
   * corrected it only when the next tick eventually fired. For most screens that is a blemish. Here
   * the stale figure is *how much an agent may still spend*, which is the one number somebody opens
   * this app to check before deciding whether to intervene, and it was wrong for ten seconds at
   * exactly the moment they were looking at it.
   */
  useEffect(() => {
    if (!account) return;
    const watch = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => watch.remove();
  }, [account, refresh]);

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
      /** What is running, so only its own button shows it. */
      action: PendingAction,
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
      setActionError(null);
      setPending(action);
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
          setActionError(describeFailure(cause, MANDATE_FAILURES));
        } finally {
          setPending(null);
        }
      })();
    },
    [account, busy, refresh],
  );

  const grant = useCallback(
    (terms: MandateTerms, onGranted?: () => void) =>
      perform(
        "granted an allowance",
        { kind: "grant", agent: terms.agent },
        async (a) => [(await grantMandate(a, terms)).grant],
        onGranted,
      ),
    [perform],
  );

  const revoke = useCallback(
    (agent: Address, onRevoked?: () => void) =>
      perform("revoked an allowance", { kind: "revoke", agent }, async (a) => [await revokeMandate(a, agent)], onRevoked),
    [perform],
  );

  /**
   * Re-scoping an existing mandate. Lowering the limit below what the agent has already spent is
   * legitimate and is how you stop it without revoking — the account refuses everything further
   * while the record of what was spent stays intact.
   */
  const changeLimit = useCallback(
    (agent: Address, limit: Usdc) => {
      const mandate = mandates.find((m) => m.agent === agent);
      if (!mandate) {
        setActionError(`no mandate for ${agent}`);
        return;
      }
      // The rail comes from the mandate rather than a default, because the two are metered
      // separately: setting the wrong one leaves the real limit untouched and adds a second meter
      // beside it, so a change meant to narrow the mandate would widen it instead.
      perform("changed an allowance", { kind: "change", agent }, async (a) => [
        await updateMandate(a, { agent, limit, rail: mandate.rail }),
      ]);
    },
    [mandates, perform],
  );

  // The action's failure first: it is the one the person is waiting on.
  return { mandates, busy, pending, error: actionError ?? readError, ready, grant, revoke, changeLimit, refresh };
}


