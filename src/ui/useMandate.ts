import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import type { ArcAccount } from "../arc/account.ts";
import {
  grantMandate, listMandates, revokeMandate, updateMandate,
  type Mandate, type MandateTerms,
} from "../arc/mandate.ts";
import { Usdc } from "../arc/usdc.ts";
import { balanceOf } from "../arc/send.ts";

/**
 * Granting, watching and revoking mandates, kept out of the view.
 *
 * Every figure here is **read back from the chain** rather than tracked locally. A mandate's
 * remaining balance is the one number a person decides on, and a local copy that drifts from
 * what the account will actually enforce is worse than no number at all — it would show someone
 * headroom their agent does not have.
 */

export interface MandateScreen {
  readonly mandates: readonly Mandate[];
  readonly balance: Usdc | null;
  readonly busy: boolean;
  /** Set when the last action failed. Cleared when the next one starts. */
  readonly error: string | null;
  grant(terms: MandateTerms): void;
  revoke(agent: Address): void;
  changeLimit(agent: Address, limit: Usdc): void;
  refresh(): void;
}

export function useMandate(account: ArcAccount | null): MandateScreen {
  const [mandates, setMandates] = useState<readonly Mandate[]>([]);
  const [balance, setBalance] = useState<Usdc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!account) return;
    void (async () => {
      try {
        const [live, funds] = await Promise.all([
          listMandates(account.address),
          balanceOf(account.address),
        ]);
        setMandates(live);
        setBalance(funds);
      } catch (cause) {
        setError(describe(cause));
      }
    })();
  }, [account]);

  // Read once when an account arrives. Payments are watched separately, by the feed.
  useEffect(refresh, [refresh]);

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
          setError(describe(cause));
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

  return { mandates, balance, busy, error, grant, revoke, changeLimit, refresh };
}

/** Surfaces the message a person can act on, not the stack. */
function describe(cause: unknown): string {
  if (cause instanceof Error) {
    const inner = cause.cause;
    const detail = inner instanceof Error ? inner.message : undefined;
    return detail ? `${cause.message} — ${detail}` : cause.message;
  }
  return String(cause);
}
