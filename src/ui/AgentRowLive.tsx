import { AgentRow } from "./AgentRow.tsx";
import { useAgentIdentity } from "./useAgentIdentity.ts";
import { useAgentNames } from "./agent-names-context.tsx";
import { lastSpentBy } from "./pulse.ts";
import { usePulse } from "./usePulse.ts";
import { useSession } from "./session-context.tsx";
import type { Mandate } from "../arc/mandate.ts";

/**
 * An agent row that knows its own identity.
 *
 * `AgentRow` renders from props and nothing else, which is what makes it previewable at its awkward
 * states. Finding an identity is not a prop: it takes the feed and a registry read, and there is no
 * reverse lookup, so it cannot be handed down from a list that would have to call a hook per item.
 *
 * So the lookup sits here, one component per row, and the row stays a drawing. The screen changes by
 * one word.
 */
export function AgentRowLive({
  mandate, name, onPress, first,
}: {
  readonly mandate: Mandate;
  readonly name: string | null;
  readonly onPress: (agent: `0x${string}`) => void;
  readonly first: boolean;
}) {
  const { activity, wallet } = useSession();
  const identity = useAgentIdentity(mandate.agent, activity.items, wallet.network);
  // How it is, from when this allowance last paid. The rows of an earlier allowance for the same
  // agent are left out, as its own screen leaves them out, so the two cannot say different things.
  const { inCurrentAllowance } = useAgentNames();
  const { pulse } = usePulse(
    mandate, lastSpentBy(mandate, activity.items.filter(inCurrentAllowance)), wallet.network.chainId,
  );

  return (
    <AgentRow mandate={mandate} network={wallet.network} name={name} identity={identity} onPress={onPress} first={first} pulse={pulse} />
  );
}
