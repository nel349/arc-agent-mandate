import { useEffect, useState } from "react";
import { reputationOf, type Feedback } from "../arc/reputation.ts";

/**
 * What has been said about this agent's identity, or nothing while there is nothing to show.
 *
 * The same rule `useAgentIdentity` follows: a registry that will not answer shows nothing rather
 * than a claim the screen has not checked. A reputation is somebody else's word about an agent, and
 * a wrong one on this screen would be worse than an empty panel.
 *
 * Keyed on the identity rather than the agent's address, because that is what the registry knows
 * and what a seller credits.
 */
export function useAgentReputation(agentId: bigint | null): readonly Feedback[] {
  const [said, setSaid] = useState<readonly Feedback[]>([]);

  useEffect(() => {
    let current = true;
    setSaid([]);
    if (agentId === null) return;
    void reputationOf(agentId)
      .then((found) => { if (current) setSaid(found); })
      .catch(() => {
        // Unreadable is not the same as none, and neither is worth interrupting anyone over. The
        // panel simply does not appear, which is where the screen started.
      });
    return () => { current = false; };
  }, [agentId]);

  return said;
}
