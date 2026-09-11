import { createContext, useContext, type ReactNode } from "react";
import { useActivity, type ActivityFeed } from "./useActivity.ts";
import { useArcAccount, type ArcWallet } from "./useArcAccount.ts";
import { useMandate, type MandateScreen } from "./useMandate.ts";

/**
 * The wallet, its allowances and what its agents did, held once for the whole app.
 *
 * All three used to live in the home screen's own state, which was fine while there was one
 * screen. With an agent's screen and a grant sheet beside it, a second `useArcAccount()` would
 * start with no wallet at all, and a second `useMandate()` would poll the chain a second time for
 * the same figures. Held here, every screen reads one account and one set of numbers, and there is
 * one poll of each.
 */
interface Session {
  readonly wallet: ArcWallet;
  readonly mandate: MandateScreen;
  readonly activity: ActivityFeed;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const wallet = useArcAccount();
  const mandate = useMandate(wallet.account);
  const activity = useActivity(wallet.account?.address ?? null);
  return <SessionContext.Provider value={{ wallet, mandate, activity }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession needs a SessionProvider above it.");
  return session;
}
