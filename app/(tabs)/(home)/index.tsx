import { useRouter } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, Linking, Share, StyleSheet, Text, View } from "react-native";
import { TESTNET_FAUCET_URL } from "../../../src/arc/chain.ts";
import { ActivityRow } from "../../../src/ui/ActivityRow.tsx";
import { AgentRowLive } from "../../../src/ui/AgentRowLive.tsx";
import { MoreRow } from "../../../src/ui/MoreRow.tsx";
import { activityRowText } from "../../../src/ui/activity-format.ts";
import { Button } from "../../../src/ui/Button.tsx";
import { Label } from "../../../src/ui/Label.tsx";
import { ERROR_LINES, Note } from "../../../src/ui/Note.tsx";
import { Screen } from "../../../src/ui/Screen.tsx";
import { Surface } from "../../../src/ui/Surface.tsx";
import { agentRoute, ROUTES } from "../../../src/ui/routes.ts";
import { useOpenReceipt } from "../../../src/ui/useOpenReceipt.ts";
import { useAgentNames } from "../../../src/ui/agent-names-context.tsx";
import { shortAddress } from "../../../src/ui/mandate-format.ts";
import { useSession } from "../../../src/ui/session-context.tsx";
import { useTheme } from "../../../src/ui/theme-context.tsx";
import { tokens } from "../../../src/ui/tokens.ts";

/**
 * The product: what you hold, which agents may spend it, and how much each has left.
 *
 * A list you tap into. Granting is a sheet opened from the button at the bottom, and revoking
 * lives on each agent's own screen. This screen used to do all four jobs in one scroll, with the
 * grant form above the allowances, so the thing you check most sat under the thing you do least.
 */
export default function AllowancesScreen() {
  const { wallet, mandate, activity } = useSession();
  const { ofAllowance, ofRow } = useAgentNames();
  const router = useRouter();
  const c = useTheme().color;

  const open = useCallback((agent: `0x${string}`) => router.push(agentRoute(agent)), [router]);
  const openReceipt = useOpenReceipt();

  // Without a wallet this tab does not exist: `app/(tabs)/_layout.tsx` has already sent the person
  // to the welcome screen. This is the frame before that redirect lands, not a state to design for.
  if (wallet.account === null) return null;

  const address = wallet.account.address;
  // The first read has not come back yet. Saying "no allowances" before knowing would be a claim.
  const loading = mandate.ready === null && mandate.error === null;

  return (
    <Screen
      footer={
        <Button
          tier="solid"
          icon="add"
          title="New allowance"
          onPress={() => router.push(ROUTES.grant)}
          disabled={mandate.ready === false}
        />
      }
    >
      <Surface raised>
        <Text style={[styles.caption, { color: c.muted }]}>In your wallet</Text>
        <View style={styles.walletRow}>
          <Text style={[styles.balance, { color: c.paper }]} accessibilityLabel={`${wallet.balance?.format(2) ?? "Unknown"} USDC in your wallet`}>
            {wallet.balance?.format(2) ?? "—"}
            <Text style={[styles.unit, { color: c.dim }]}>  USDC</Text>
          </Text>
          {/* Sharing, because that is how money arrives: the address has to reach whoever or
              whatever is sending it. Copying would need another native module; the share sheet
              has Copy in it already. */}
          <Button
            compact
            icon="share-outline"
            title="Share address"
            onPress={() => void Share.share({ message: address })}
          />
        </View>
        <Text style={[styles.address, { color: c.dim }]}>{shortAddress(address)} on Arc testnet</Text>
        {/* Step 1 of the journey is a funded wallet. An agent can never spend more than this
            holds, so the way to add some sits beside the figure it changes. */}
        <Button
          compact
          icon="open-outline"
          title="Get test USDC"
          onPress={() => void Linking.openURL(TESTNET_FAUCET_URL)}
        />
        <Text style={[styles.caption, { color: c.muted }]}>
          On the faucet, choose Arc testnet and paste your wallet&apos;s address, from Share address above.
        </Text>
      </Surface>

      {wallet.error !== null && <Note tone="warn" lines={ERROR_LINES}>{wallet.error}</Note>}
      {mandate.error !== null && <Note tone="warn" lines={ERROR_LINES}>{mandate.error}</Note>}

      <Label>Agents</Label>
      {loading ? (
        <ActivityIndicator color={c.dim} accessibilityLabel="Reading your allowances" />
      ) : mandate.mandates.length === 0 ? (
        <Surface>
          <Text style={[styles.emptyTitle, { color: c.paper }]}>No allowances yet</Text>
          <Text style={[styles.emptyBody, { color: c.dim }]}>
            Next, on your computer: connect your agent, and it shows a code. Then tap New allowance
            and scan it. The agent appears here, with what it has left and until when.
          </Text>
        </Surface>
      ) : (
        <Surface style={styles.group}>
          {mandate.mandates.map((item, index) => (
            <AgentRowLive
              key={item.agent}
              mandate={item}
              name={ofAllowance(item.agent)}
              onPress={open}
              first={index === 0}
            />
          ))}
        </Surface>
      )}

      {activity.items.length > 0 && (
        <>
          <Label>Recent activity</Label>
          <Surface style={styles.group}>
            {activity.items.slice(0, RECENT_ROWS).map((item, index) => {
              const text = activityRowText(item, { name: ofRow(item), withAgent: true, underDayHeading: false });
              return (
                <ActivityRow
                  key={`${item.tx}:${item.logIndex}`}
                  item={item}
                  text={text}
                  onPress={openReceipt}
                  first={index === 0}
                />
              );
            })}
            <MoreRow title="See all activity" onPress={() => router.push(ROUTES.activity)} />
          </Surface>
        </>
      )}

      {mandate.ready === false && (
        <Note tone="warn">Allowances are not deployed on Arc testnet yet, so none can be granted.</Note>
      )}
    </Screen>
  );
}

/** Enough to see that an agent is active, and what it last did, without turning home into the feed. */
const RECENT_ROWS = 3;

const styles = StyleSheet.create({
  caption: tokens.type.footnote,
  walletRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: tokens.space.sm },
  balance: {
    ...tokens.type.largeTitle,
    flexShrink: 1,
    // Re-read every ten seconds; proportional digits would change width on every update.
    fontVariant: [...tokens.font.tabular],
  },
  unit: { ...tokens.type.body, fontWeight: "400", letterSpacing: 0 },
  address: tokens.type.data,
  /** Rows run edge to edge inside the group, separated by hairlines, as an iOS inset list does. */
  group: { padding: 0, gap: 0, overflow: "hidden" },
  emptyTitle: tokens.type.headline,
  emptyBody: tokens.type.subheadline,
});
