import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, StyleSheet, Text } from "react-native";
import { ActivityRow } from "../../src/ui/ActivityRow.tsx";
import { AllowanceCard } from "../../src/ui/AllowanceCard.tsx";
import { AgentGauge } from "../../src/ui/AgentGauge.tsx";
import { MoreRow } from "../../src/ui/MoreRow.tsx";
import { activityRowText, lastSpentAt } from "../../src/ui/activity-format.ts";
import { formatAmount, unitOf } from "../../src/ui/coin.ts";
import { Button } from "../../src/ui/Button.tsx";
import { confirmInBrowser } from "../../src/ui/confirm-in-browser.ts";
import { DetailRow } from "../../src/ui/DetailRow.tsx";
import { Field } from "../../src/ui/Field.tsx";
import { Label } from "../../src/ui/Label.tsx";
import { ERROR_LINES, Note } from "../../src/ui/Note.tsx";
import { Screen } from "../../src/ui/Screen.tsx";
import { Surface } from "../../src/ui/Surface.tsx";
import { MAX_AGENT_NAME } from "../../src/ui/agent-names.ts";
import { useAgentNames } from "../../src/ui/agent-names-context.tsx";
import { feelWarning } from "../../src/ui/haptics.ts";
import {
  agentHoldingNote, faceOfMandate, identityLabel, lastUsedLabel, revokeWarning,
} from "../../src/ui/mandate-format.ts";
import { scoreLabel, scoreMeaning, scoreTitle, writtenBy } from "../../src/ui/reputation-format.ts";
import { activityRoute } from "../../src/ui/routes.ts";
import { useAgentIdentity } from "../../src/ui/useAgentIdentity.ts";
import { useAgentReputation } from "../../src/ui/useAgentReputation.ts";
import { feedOf } from "../../src/ui/arrivals.ts";
import { useArrivals } from "../../src/ui/useArrivals.ts";
import { rowKey } from "../../src/arc/activity.ts";
import { useOpenReceipt } from "../../src/ui/useOpenReceipt.ts";
import { useSession } from "../../src/ui/session-context.tsx";
import { useTheme } from "../../src/ui/theme-context.tsx";
import { tokens } from "../../src/ui/tokens.ts";
import { useLeave } from "../../src/ui/useLeave.ts";
import { useShareAddress } from "../../src/ui/useShareAddress.ts";
import { useConnectedSite } from "../../src/ui/useConnectedSite.ts";
import { connectedUrl } from "../../src/ui/connect.ts";

/**
 * One allowance in full: what is left, what it means, who holds it, and the way to end it.
 *
 * Revoke lives here and nowhere else. On the list it was a button on every card, the same weight
 * as everything around it; here it is the last thing on the screen of the one agent it applies to,
 * and it asks first, naming what is being withdrawn.
 */
export default function AgentScreen() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const { mandate, activity, wallet } = useSession();
  const site = useConnectedSite();
  const walletAddress = wallet.account?.address ?? null;
  const network = wallet.network;
  const { ofAllowance, inCurrentAllowance, renameAllowance } = useAgentNames();
  const router = useRouter();
  const leave = useLeave();
  const c = useTheme().color;

  const openReceipt = useOpenReceipt();

  const found = mandate.mandates.find((m) => m.agent.toLowerCase() === String(address).toLowerCase()) ?? null;
  const name = found === null ? null : ofAllowance(found.agent);
  const shareAddress = useShareAddress(found?.agent ?? "");
  /** Confirmed against the registry before it is shown; see `useAgentIdentity`. */
  const identity = useAgentIdentity(found?.agent ?? null, activity.items, network);
  /**
   * What others have said about that identity. Empty until there is something, and empty again if
   * the registry will not answer: a score is somebody else's word, and a wrong one here would be
   * worse than no panel at all.
   */
  const reputation = useAgentReputation(identity, network);
  const newest = reputation[0];
  // The rows that have landed since this screen last drew the feed, which come in lit.
  const arrived = useArrivals(activity.items, feedOf(network.chainId, walletAddress));

  /** What is being typed into the name field, or `null` when it shows the kept name. */
  const [draft, setDraft] = useState<string | null>(null);

  /** Whether this screen is still showing when a revoke lands, so closing it cannot pop the list. */
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);

  const keepName = useCallback(() => {
    if (found === null || draft === null) return;
    renameAllowance(found.agent, draft);
    setDraft(null);
  }, [found, draft, renameAllowance]);

  /**
   * Asked as a native alert with Revoke drawn as destructive, which is how iOS asks before anything
   * that cannot be undone. The sentence names the agent and says the one thing a revoke does not
   * do, with the amount it leaves behind, because a person who assumes it claws money back is making
   * a decision on a false premise.
   *
   * In a browser the same question goes through the browser's own dialog: `Alert.alert` is an empty
   * function on the web, so asking through it there revoked nothing. See `confirm-in-browser.ts`.
   */
  const confirmRevoke = useCallback(() => {
    if (found === null) return;
    const title = "Revoke this allowance?";
    const message = revokeWarning(name, found.escrow, network);
    const revoke = () => mandate.revoke(found.agent, () => {
      feelWarning();
      if (open.current) leave();
    });
    if (Platform.OS === "web") {
      confirmInBrowser({ title, message }, revoke);
      return;
    }
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: revoke },
    ]);
  }, [found, name, mandate, leave, network]);

  if (found === null) {
    return (
      <>
        <Stack.Screen options={{ title: "Allowance" }} />
        <Screen>
          <Surface>
            <Text style={[styles.goneTitle, { color: c.paper }]}>This allowance is not active</Text>
            <Text style={[styles.goneBody, { color: c.dim }]}>
              It may have been revoked. Allowances that are still active are listed on the first screen.
            </Text>
            <Button title="Back to allowances" onPress={leave} />
          </Surface>
        </Screen>
      </>
    );
  }

  const holding = agentHoldingNote(found.agentFloat);
  // This allowance's rows only. The agent's earlier allowances are in "See all", each under its own name.
  const payments = activity.items.filter(
    (i) => i.agent.toLowerCase() === found.agent.toLowerCase() && inCurrentAllowance(i),
  );
  // The chain's own last-used time is never set on this rail, so the feed says when money last moved.
  const lastUsed = { ...found, lastUsedAt: found.lastUsedAt ?? lastSpentAt(payments) };

  return (
    <>
      <Stack.Screen options={{ title: name ?? "Allowance" }} />
      <Screen>
        {/* First, what somebody opens this screen to watch: what is left, and whether it is spending. */}
        <AgentGauge mandate={found} network={network} lastSpent={lastUsed.lastUsedAt} />
        {/* Then the allowance as the card it was issued as: its terms, which do not change. */}
        <AllowanceCard face={faceOfMandate({ mandate: found, name, network })} />

        {mandate.error !== null && <Note tone="warn" lines={ERROR_LINES}>{mandate.error}</Note>}
        {holding !== null && <Note tone="warn">{`This agent's own wallet holds money: ${holding}.`}</Note>}

        <Label>Payments</Label>
        {payments.length === 0 ? (
          <Surface>
            <Text style={[styles.goneBody, { color: c.dim }]}>
              {activity.loading
                ? `Reading this agent's payments from ${network.name}.`
                : "No payments from this allowance in the time shown. Each one appears here within a few seconds of the agent spending."}
            </Text>
          </Surface>
        ) : (
          <Surface style={styles.group}>
            {payments.slice(0, AGENT_ROWS).map((item, index) => {
              const text = activityRowText(item, { name, withAgent: false, underDayHeading: false });
              return (
                <ActivityRow
                  key={rowKey(item)}
                  network={wallet.network}
                  item={item}
                  text={text}
                  onPress={openReceipt}
                  first={index === 0}
                  fresh={arrived.has(rowKey(item))}
                />
              );
            })}
            <MoreRow title="See all" onPress={() => router.push(activityRoute(found.agent))} />
          </Surface>
        )}

        <Label>Details</Label>
        <Surface style={styles.group}>
          <DetailRow label="Last used" value={lastUsedLabel(lastUsed)} first />
          {!found.escrow.isZero() && (
            <DetailRow label="In its escrow" value={`${formatAmount(found.escrow)} ${unitOf(network)}`} />
          )}
          {identity !== null && <DetailRow label="Identity" value={identityLabel(identity)} />}
        </Surface>

        {/* What the agent earned, as opposed to what it spent. Shown only when the registry has
            something to say: an agent that has not been scored simply has no panel here. */}
        {newest !== undefined && (
          <>
            <Label>Earned</Label>
            <Surface style={styles.group}>
              {reputation.map((said, index) => (
                <DetailRow
                  key={`${said.client}:${index}`}
                  label={scoreTitle(said)}
                  value={scoreLabel(said)}
                  first={index === 0}
                />
              ))}
            </Surface>
            <Note>
              {[scoreMeaning(newest), writtenBy(newest)].filter((line): line is string => line !== null).join(" ")}
            </Note>
          </>
        )}

        {/* Back to the site that asked to know this wallet, where the agent's runs and rep are shown. */}
        {site !== null && walletAddress !== null && (
          <Button compact icon="open-outline" title={`See it on ${site.host}`}
                  onPress={() => void Linking.openURL(connectedUrl(site, walletAddress))} />
        )}

        <Label>Agent</Label>
        <Surface>
          <Field
            label="Name"
            value={draft ?? name ?? ""}
            onChangeText={setDraft}
            onDone={keepName}
            placeholder="Give it a name"
            hint="Kept on this phone only. The chain knows this agent by its address."
            maxLength={MAX_AGENT_NAME}
          />
          <Button compact icon="share-outline" title={shareAddress.title} onPress={() => void shareAddress.share()} />
        </Surface>

        {/* Spins only for this agent's own revoke. Anything else running, a grant landing in the
            background say, makes it unavailable without pretending it is the thing in progress. */}
        <Button
          tone="warn"
          title="Revoke allowance"
          onPress={confirmRevoke}
          busy={mandate.pending?.kind === "revoke" && mandate.pending.agent === found.agent}
          disabled={mandate.busy}
        />
      </Screen>
    </>
  );
}

/** The latest few on the agent's own screen; "See all" has the rest. */
const AGENT_ROWS = 5;

const styles = StyleSheet.create({
  group: { padding: 0, gap: 0, overflow: "hidden" },
  goneTitle: tokens.type.headline,
  goneBody: tokens.type.subheadline,
});
