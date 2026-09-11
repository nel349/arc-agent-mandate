import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readPreference, writePreference } from "./preference-store.ts";
import { AGENT_NAMES_KEY, agentNameOf, NO_NAMES, parseAgentNames, withAgentName, type AgentNames } from "./agent-names.ts";

/**
 * Agent names, loaded once and shared by every screen.
 *
 * One provider rather than a read per row: the home list, an agent's screen and the grant sheet
 * all show the same names, and three copies of one record is how a rename shows on one screen and
 * not the next.
 */
interface AgentNamesValue {
  /** The name, or `null` for an agent nobody has named. */
  nameOf(agent: string): string | null;
  /** Sets the name, or removes it when blank. Kept even if saving fails, for this session. */
  rename(agent: string, name: string): void;
}

const AgentNamesContext = createContext<AgentNamesValue>({
  nameOf: () => null,
  rename: () => {},
});

export function AgentNamesProvider({ children }: { readonly children: ReactNode }) {
  const [names, setNames] = useState<AgentNames>(NO_NAMES);

  useEffect(() => {
    void readPreference(AGENT_NAMES_KEY).then((stored) => setNames(parseAgentNames(stored)));
  }, []);

  const rename = useCallback((agent: string, name: string) => {
    setNames((current) => {
      const next = withAgentName(current, agent, name);
      // Fire and forget, like the theme: the screen has already changed, and a failed write costs
      // a nickname, not money.
      void writePreference(AGENT_NAMES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<AgentNamesValue>(
    () => ({ nameOf: (agent) => agentNameOf(names, agent), rename }),
    [names, rename],
  );
  return <AgentNamesContext.Provider value={value}>{children}</AgentNamesContext.Provider>;
}

export function useAgentNames(): AgentNamesValue {
  return useContext(AgentNamesContext);
}
