import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Address } from "viem";
import { useW1Ceremony } from "../src/ui/useW1Ceremony.ts";
import { tokens } from "../src/ui/tokens.ts";

/**
 * The W1 harness. One button per step, and a log — the exit condition for this week is "a
 * gasless send worked on a real device", not a design.
 *
 * All logic lives in `useW1Ceremony`; this file renders it and nothing else.
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

export default function W1Screen() {
  const { log, busy, address, balance, connect, signIn, refresh, send } = useW1Ceremony();

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      // Lets iOS apply safe-area insets natively, rather than a SafeAreaView wrapper or manual
      // padding that has to be re-guessed per device.
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.card}>
        <Text style={styles.label}>smart account</Text>
        <Text style={styles.mono}>{address ?? NOT_SET}</Text>
        <Text style={styles.label}>native balance</Text>
        <Text style={styles.mono}>{balance ?? NOT_SET}</Text>
      </View>

      <Step step={{ title: "1 · Register NEW passkey + account", onPress: connect, busy }} />
      <Step step={{ title: "1b · Sign in with an existing passkey", onPress: signIn, busy }} />
      <Step step={{ title: "2 · Read balance from Arc", onPress: refresh, busy, disabled: !address }} />
      <Step step={{ title: "3 · Send 0.01 USDC (gasless)", onPress: () => send(DEMO_RECIPIENT), busy, disabled: !address }} />

      <Text style={styles.label}>log</Text>
      {log.map((line) => (
        <Text key={line.id} style={styles.logLine}>{line.text}</Text>
      ))}
    </ScrollView>
  );
}

interface StepProps {
  readonly title: string;
  readonly onPress: () => void;
  readonly busy: boolean;
  readonly disabled?: boolean;
}

/** Presentational only — no state, no effects, no fetching. */
function Step({ step }: { readonly step: StepProps }) {
  const isOff = step.busy || step.disabled === true;
  return (
    <Pressable style={[styles.button, isOff && styles.buttonOff]} onPress={step.onPress} disabled={isOff}>
      {step.busy ? <ActivityIndicator /> : <Text style={styles.buttonText}>{step.title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: tokens.color.background },
  content: { padding: tokens.space.lg, gap: tokens.space.md },
  card: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.base,
    gap: tokens.space.xs,
  },
  label: {
    color: tokens.color.textMuted,
    fontSize: tokens.font.label,
    textTransform: "uppercase",
    letterSpacing: tokens.font.labelTracking,
  },
  mono: { color: tokens.color.text, fontFamily: tokens.font.mono, fontSize: tokens.font.body },
  button: {
    backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.md,
    padding: tokens.space.base,
    alignItems: "center",
  },
  buttonOff: { opacity: tokens.opacity.disabled },
  buttonText: { color: tokens.color.onAccent, fontWeight: "600" },
  logLine: {
    color: tokens.color.textDim,
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.small,
    lineHeight: tokens.font.smallLineHeight,
  },
});
