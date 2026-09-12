import { Stack, useLocalSearchParams } from "expo-router";
import type { ActivityKind } from "../src/arc/activity.ts";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Button } from "../src/ui/Button.tsx";
import { DetailRow } from "../src/ui/DetailRow.tsx";
import { Note } from "../src/ui/Note.tsx";
import { Screen } from "../src/ui/Screen.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { explorerTxUrl } from "../src/arc/chain.ts";
import {
  ACTIVITY_TITLES, activityAmount, DRAW_EXPLAINED, PAID_EXPLAINED, REGISTERED_EXPLAINED,
} from "../src/ui/activity-format.ts";
import { useAgentNames } from "../src/ui/agent-names-context.tsx";
import { clockTime, weekdayDayMonth } from "../src/ui/calendar.ts";
import { grantedWithoutCode, NO_PAIRING_CODE } from "../src/ui/grant-entry.ts";
import { shortAddress } from "../src/ui/mandate-format.ts";
import { useSession } from "../src/ui/session-context.tsx";
import { useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

/** What each row was, in full. One table, so no kind can reach this screen without a sentence. */
const EXPLAINED: Readonly<Record<ActivityKind, string>> = {
  draw: DRAW_EXPLAINED,
  paid: PAID_EXPLAINED,
  registered: REGISTERED_EXPLAINED,
  granted: "Your wallet gave this agent an allowance. It was signed with your passkey.",
  revoked: "Your wallet took this agent's allowance away. It was signed with your passkey.",
};

/**
 * One row of the feed, in full, as a half-height sheet.
 *
 * A sheet because a receipt is a glance at one item that belongs to the list under it. It names
 * what the chain says and what it does not, and hands the person the transaction to check for
 * themselves on ArcScan, which is the only thing on this screen they do not have to take our word
 * for.
 */
export default function ReceiptScreen() {
  const { tx, log } = useLocalSearchParams<{ tx: string; log: string }>();
  const { activity } = useSession();
  const { ofRow } = useAgentNames();
  const c = useTheme().color;

  const item = activity.items.find((i) => i.tx === tx && String(i.logIndex) === log) ?? null;
  const link = typeof tx === "string" ? explorerTxUrl(tx) : null;

  if (item === null) {
    return (
      <Screen>
        <Note>This entry is no longer kept on this phone. The transaction is still on Arc.</Note>
        {link !== null && <Button icon="open-outline" title="View on ArcScan" onPress={() => void Linking.openURL(link)} />}
      </Screen>
    );
  }

  const amount = activityAmount(item);
  const name = ofRow(item);
  /** The one place this receipt can be checked without taking the app's word for it. */
  const openTransaction = () => void Linking.openURL(explorerTxUrl(item.tx));

  return (
    <>
      <Stack.Screen options={{ title: ACTIVITY_TITLES[item.kind] }} />
      <Screen>
        {amount !== null && (
          <View style={styles.head}>
            <Text style={[styles.amount, { color: c.paper }]}>{amount}</Text>
            <Text style={[styles.unit, { color: c.muted }]}>USDC</Text>
          </View>
        )}

        <Surface style={styles.group}>
          <DetailRow label="Agent" value={name ?? shortAddress(item.agent)} first />
          {name !== null && <DetailRow label="Address" value={shortAddress(item.agent)} data />}
          {item.to !== undefined && <DetailRow label="Paid to" value={shortAddress(item.to)} data />}
          {item.identity !== undefined && <DetailRow label="Identity" value={`ERC-8004 #${item.identity}`} />}
          <DetailRow label="When" value={`${weekdayDayMonth(item.at)}, ${clockTime(item.at)}`} />
          <DetailRow
            label="Transaction"
            value={shortAddress(item.tx)}
            data
            onPress={openTransaction}
            hint="Opens this transaction on ArcScan"
          />
        </Surface>

        <Text style={[styles.explained, { color: c.dim }]}>
          {EXPLAINED[item.kind]}
        </Text>

        {grantedWithoutCode(item.tag) && <Note tone="warn">{NO_PAIRING_CODE}</Note>}

        <Button icon="open-outline" title="View on ArcScan" onPress={openTransaction} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: tokens.space.xs, paddingVertical: tokens.space.sm },
  amount: { ...tokens.type.hero, fontVariant: [...tokens.font.tabular] },
  unit: tokens.type.headline,
  group: { padding: 0, gap: 0, overflow: "hidden" },
  explained: tokens.type.footnote,
});
