import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Activity } from "../arc/activity.ts";
import { readPreference, writePreference } from "./preference-store.ts";
import {
  AGENT_NAMES_KEY, allowanceKey, allowanceName, grantAt, grantsIn, NO_NAMES, parseAgentNames,
  withAgentName, withNewAllowance, type AgentNames, type GrantLog,
} from "./agent-names.ts";
import { useSession } from "./session-context.tsx";

/**
 * Allowance names, loaded once and shared by every screen.
 *
 * One provider rather than a read per row: the home list, an agent's screen, the feed and the grant
 * flow all show the same names, and three copies of one record is how a rename shows on one screen
 * and not the next. It reads the feed's grants, because a name belongs to one allowance and the feed
 * is where the phone learns which allowance each row happened under.
 */
interface AgentNamesValue {
  /** The name a feed row shows: the name of the allowance it happened under, or `null`. */
  ofRow(item: Activity): string | null;
  /** The name an agent's current allowance shows, or `null`. */
  ofAllowance(agent: string): string | null;
  /** Whether a row happened under the agent's current allowance, rather than one before it. */
  inCurrentAllowance(item: Activity): boolean;
  /** Names the agent's current allowance, or unnames it when blank. Kept even if saving fails, for this session. */
  renameAllowance(agent: string, name: string): void;
  /**
   * Names an allowance that has just landed, by its own log, and leaves the allowance before it the
   * name it had.
   */
  nameGranted(agent: string, granted: GrantLog | null, name: string): void;
}

const AgentNamesContext = createContext<AgentNamesValue>({
  ofRow: () => null,
  ofAllowance: () => null,
  inCurrentAllowance: () => true,
  renameAllowance: () => {},
  nameGranted: () => {},
});

export function AgentNamesProvider({ children }: { readonly children: ReactNode }) {
  const [names, setNames] = useState<AgentNames>(NO_NAMES);
  const { activity } = useSession();
  const grants = useMemo(() => grantsIn(activity.items), [activity.items]);

  useEffect(() => {
    void readPreference(AGENT_NAMES_KEY).then((stored) => setNames(parseAgentNames(stored)));
  }, []);

  /** Applied to whatever is current, and saved. Fire and forget, like the theme: a failed write costs a nickname. */
  const update = useCallback((change: (current: AgentNames) => AgentNames) => {
    setNames((current) => {
      const next = change(current);
      void writePreference(AGENT_NAMES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<AgentNamesValue>(() => ({
    ofRow: (item) => allowanceName(names, item.agent, grantAt(item.agent, item, grants), grantAt(item.agent, null, grants)),
    ofAllowance: (agent) => {
      const current = grantAt(agent, null, grants);
      return allowanceName(names, agent, current, current);
    },
    inCurrentAllowance: (item) => {
      const current = grantAt(item.agent, null, grants);
      return current === null || grantAt(item.agent, item, grants)?.key === current.key;
    },
    renameAllowance: (agent, name) => {
      const current = grantAt(agent, null, grants);
      update((record) => withAgentName(record, current?.key ?? agent, name));
    },
    nameGranted: (agent, granted, name) => {
      // The allowance before this one: the latest grant read that is not the one just made. The key
      // is built by `allowanceKey` and nowhere else, or a name and its grant stop matching silently.
      const newKey = granted === null ? null : allowanceKey(granted.tx, granted.logIndex);
      const previous = grantAt(agent, null, grants.filter((grant) => grant.key !== newKey));
      update((record) => withNewAllowance(record, agent, granted, previous, name));
    },
  }), [names, grants, update]);

  return <AgentNamesContext.Provider value={value}>{children}</AgentNamesContext.Provider>;
}

export function useAgentNames(): AgentNamesValue {
  return useContext(AgentNamesContext);
}
