import { memo, useCallback } from "react";
import { FlashList } from "@shopify/flash-list";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Address } from "viem";
import { useW1Ceremony, type LogLine } from "../src/ui/useW1Ceremony.ts";
import { tokens } from "../src/ui/tokens.ts";
import { useTheme } from "../src/ui/theme-context.tsx";

/**
 * The developer harness. One button per step, and a log.
 *
 * Kept alongside the product screen because when a passkey ceremony or a bundler call fails on a
 * real device, this is the only place that says why. It is not part of the product.
 *
 * All logic lives in `useW1Ceremony`; this file renders it and nothing else.
 *
 * The log is a **virtualized list with the controls as its header**, rather than a `ScrollView`
 * with mapped children. A `ScrollView` mounts every row upfront, and this log grows without
 * bound. It also means there is only one scrolling surface: a `FlashList` nested inside a
 * `ScrollView` would virtualize against the wrong viewport and render everything anyway.
 */

/**
 * Where the demo sends. A module constant, not `useState` — it never changes, and `useState`
 * for a constant implies otherwise to every later reader.
 *
 * Deliberately NOT `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`: that is Anvil's account #1
 * and Arc has blocklisted it as a test address for restricted transfer behaviour, so sending
 * there reverts with "Blocked address" during gas estimation. See GAP_INVENTORY.md.
 */
const DEMO_RECIPIENT: Address = "0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e";

const NOT_SET = "—";

/** Uniform row height. FlashList v2 measures rows itself, so this is only the text metric. */
const LOG_ROW_HEIGHT = tokens.font.smallLineHeight;

export default function DevHarnessScreen() {
  const c = useTheme().color;
  const { log, busy, address, balance, connect, signIn, refresh, send } = useW1Ceremony();

  // Stable across renders. An inline arrow would hand the memoized header a new prop every time
  // the log grows, which is exactly when re-rendering it is most wasteful.
  const sendToDemoRecipient = useCallback(() => send(DEMO_RECIPIENT), [send]);

  const header = (
    <View style={styles.header}>
      <View style={[styles.card, { backgroundColor: c.glass, borderColor: c.hairline }]}>
        <Text style={[styles.label, { color: c.muted }]}>smart account</Text>
        <Text style={[styles.mono, { color: c.paper }]}>{address ?? NOT_SET}</Text>
        <Text style={[styles.label, { color: c.muted }]}>native balance</Text>
        <Text style={[styles.mono, { color: c.paper }]}>{balance ?? NOT_SET}</Text>
      </View>

      <Step title="1 · Register NEW passkey + account" onPress={connect} busy={busy} />
      <Step title="1b · Sign in with an existing passkey" onPress={signIn} busy={busy} />
      <Step title="2 · Read balance from Arc" onPress={refresh} busy={busy} disabled={!address} />
      <Step title="3 · Send 0.01 USDC (gasless)" onPress={sendToDemoRecipient} busy={busy} disabled={!address} />

      <Text style={[styles.label, { color: c.muted }]}>log</Text>
    </View>
  );

  return (
    <FlashList
      data={log}
      renderItem={renderLogLine}
      keyExtractor={keyOfLogLine}
      ListHeaderComponent={header}
      style={StyleSheet.flatten([styles.page, { backgroundColor: c.groundMid }])}
      contentContainerStyle={styles.content}
      // Lets iOS apply safe-area insets natively, rather than a SafeAreaView wrapper or manual
      // padding that has to be re-guessed per device.
      contentInsetAdjustmentBehavior="automatic"
    />
  );
}

// Declared once at module scope. Defined inside the component, these would be new references on
// every render, and the list would treat every row as changed.
const renderLogLine = ({ item }: { item: LogLine }) => <LogRow text={item.text} />;
const keyOfLogLine = (item: LogLine) => String(item.id);

/** A single log line. Takes a string rather than the entry object, so its memo compares by value. */
const LogRow = memo(function LogRow({ text }: { readonly text: string }) {
  const c = useTheme().color;
  return <Text style={[styles.logLine, { color: c.dim }]}>{text}</Text>;
});

/** Presentational only — no state, no effects, no fetching. */
const Step = memo(function Step({
  title, onPress, busy, disabled,
}: {
  readonly title: string;
  readonly onPress: () => void;
  readonly busy: boolean;
  readonly disabled?: boolean;
}) {
  const c = useTheme().color;
  const isOff = busy || disabled === true;
  return (
    // Two prebuilt styles rather than an inline `[a, cond && b]` array, which allocates a new
    // array on every render and defeats the memo above it.
    <Pressable style={[styles.button, { backgroundColor: c.actionFill }, isOff && styles.off]} onPress={onPress} disabled={isOff}>
      {busy ? <ActivityIndicator color={c.actionText} /> : <Text style={[styles.buttonText, { color: c.actionText }]}>{title}</Text>}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: tokens.space.lg },
  header: { gap: tokens.space.md, paddingBottom: tokens.space.md },
  card: {
    borderWidth: 1,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.base,
    gap: tokens.space.xs,
  },
  label: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.label,
    textTransform: "uppercase",
    letterSpacing: tokens.font.labelTracking,
  },
  mono: { fontFamily: tokens.font.mono, fontSize: tokens.font.small },
  button: {
    borderRadius: tokens.radius.lg,
    padding: tokens.space.base,
    alignItems: "center",
    minHeight: tokens.size.tapTarget,
    justifyContent: "center",
  },
  off: { opacity: tokens.opacity.disabled },
  buttonText: { fontFamily: tokens.font.mono, fontSize: tokens.font.small, fontWeight: "700" },
  logLine: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.small,
    // No fixed lineHeight. React Native scales `fontSize` with the system text setting but leaves
    // `lineHeight` alone, so a hardcoded one clips the glyphs of anyone using large text.
  },
});
