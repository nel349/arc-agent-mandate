import { Stack, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Share, StyleSheet, Text, View } from "react-native";
import type { Activity } from "../src/arc/activity.ts";
import { ActivityRow } from "../src/ui/ActivityRow.tsx";
import { AgentRow } from "../src/ui/AgentRow.tsx";
import { MoreRow } from "../src/ui/MoreRow.tsx";
import { activityRowText } from "../src/ui/activity-format.ts";
import { ArcRing } from "../src/ui/ArcRing.tsx";
import { Button } from "../src/ui/Button.tsx";
import { Label } from "../src/ui/Label.tsx";
import { Note } from "../src/ui/Note.tsx";
import { Screen } from "../src/ui/Screen.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { useAgentNames } from "../src/ui/agent-names-context.tsx";
import { shortAddress } from "../src/ui/mandate-format.ts";
import { useSession } from "../src/ui/session-context.tsx";
import { useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

/**
 * The product: what you hold, which agents may spend it, and how much each has left.
 *
 * A list you tap into. Granting is a sheet opened from the button at the bottom, and revoking
 * lives on each agent's own screen. This screen used to do all four jobs in one scroll, with the
 * grant form above the allowances, so the thing you check most sat under the thing you do least.
 */
export default function AllowancesScreen() {
  const { wallet, mandate, activity } = useSession();
  const { nameOf } = useAgentNames();
  const router = useRouter();
  const c = useTheme().color;

  const open = useCallback((agent: `0x${string}`) => router.push(`/agent/${agent}`), [router]);
  const openReceipt = useCallback(
    (item: Activity) => router.push({ pathname: "/receipt", params: { tx: item.tx, log: String(item.logIndex) } }),
    [router],
  );

  if (wallet.account === null) return <Welcome />;

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
          onPress={() => router.push("/grant")}
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
            Give an agent an allowance and it appears here, with what it has left and until when.
          </Text>
        </Surface>
      ) : (
        <Surface style={styles.group}>
          {mandate.mandates.map((item, index) => (
            <AgentRow
              key={item.agent}
              mandate={item}
              name={nameOf(item.agent)}
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
              const text = activityRowText(item, { name: nameOf(item.agent), withAgent: true, underDayHeading: false });
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
            <MoreRow title="See all activity" onPress={() => router.push("/activity")} />
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

/**
 * The first screen anyone sees, which used to say "No wallet yet" over two buttons and nothing
 * else. It now says what the app is for, shows the ring as the idea, and says what a passkey means
 * here, because "Create a wallet" is a big ask from an app that has not yet said why.
 */
function Welcome() {
  const { wallet } = useSession();
  const c = useTheme().color;
  /**
   * Which of the two was tapped, so only that one spins. Both used to take `wallet.busy`, and
   * tapping either put a spinner on both.
   */
  const [chosen, setChosen] = useState<"create" | "signIn" | null>(null);
  const working = (which: "create" | "signIn") => wallet.busy && chosen === which;

  return (
    <>
      {/* No "Allowances" over a screen that cannot have any yet. */}
      <Stack.Screen options={{ title: "" }} />
      <Screen
        centered
        footer={
          <>
            <Button
              tier="solid"
              title="Create a wallet"
              onPress={() => { setChosen("create"); wallet.create(); }}
              busy={working("create")}
              disabled={wallet.busy}
            />
            <Button
              title="I already have a passkey"
              onPress={() => { setChosen("signIn"); wallet.signIn(); }}
              busy={working("signIn")}
              disabled={wallet.busy}
            />
          </>
        }
      >
        <View style={styles.welcome}>
          <ArcRing spent={WELCOME_RING} size={tokens.size.ring.welcome} label="" />
          <Text style={[styles.welcomeTitle, { color: c.paper }]}>Let an agent spend, within limits</Text>
          <Text style={[styles.welcomeBody, { color: c.muted }]}>
            Give an AI agent an allowance in USDC. It can spend up to the limit you set, until the
            date you choose, and you can take it back at any time.
          </Text>
          <Text style={[styles.welcomeNote, { color: c.dim }]}>
            Your wallet opens with Face ID. There is no password, and nothing to write down.
          </Text>
          {wallet.error !== null && <Note tone="warn" lines={ERROR_LINES}>{wallet.error}</Note>}
        </View>
      </Screen>
    </>
  );
}

/** Enough of the ring drawn to read as a limit partly used, which is the whole idea in one shape. */
const WELCOME_RING = 0.35;

/** Enough of a chain error to recognise it; the harness log has the whole thing. */
const ERROR_LINES = 3;

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
  // Centred vertically by `Screen centered`; this only centres across and spaces the parts.
  welcome: {
    alignItems: "center",
    gap: tokens.space.base,
    paddingHorizontal: tokens.space.base,
  },
  welcomeTitle: { ...tokens.type.title, textAlign: "center" },
  welcomeBody: { ...tokens.type.body, textAlign: "center" },
  welcomeNote: { ...tokens.type.footnote, textAlign: "center" },
});
