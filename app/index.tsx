import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useW1Ceremony } from "../src/ui/useW1Ceremony.ts";

/**
 * The W1 harness. One button per step, and a log — the exit condition for this week is "a
 * gasless send worked on a real device", not a design.
 *
 * All logic lives in `useW1Ceremony`; this file only renders it.
 */
export default function W1Screen() {
  const { log, busy, address, balance, connect, signIn, refresh, send } = useW1Ceremony();
  // NOT 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 — that is Anvil's account #1, and Arc has
  // deliberately blocklisted it as a test address for restricted transfer behaviour. Sending
  // there reverts with "Blocked address" at gas estimation. See GAP_INVENTORY.md.
  const [recipient] = useState("0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e");

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.label}>smart account</Text>
        <Text style={styles.mono}>{address ?? "—"}</Text>
        <Text style={styles.label}>native balance</Text>
        <Text style={styles.mono}>{balance ?? "—"}</Text>
      </View>

      <Step title="1 · Register NEW passkey + account" onPress={connect} busy={busy} />
      <Step title="1b · Sign in with an existing passkey" onPress={signIn} busy={busy} />
      <Step title="2 · Read balance from Arc" onPress={refresh} busy={busy} disabled={!address} />
      <Step title="3 · Send 0.01 USDC (gasless)" onPress={() => send(recipient)} busy={busy} disabled={!address} />

      <Text style={styles.label}>log</Text>
      {log.map((line, i) => (
        <Text key={`${i}-${line}`} style={styles.logLine}>{line}</Text>
      ))}
    </ScrollView>
  );
}

function Step({ title, onPress, busy, disabled }: {
  title: string;
  onPress: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const off = busy || disabled;
  return (
    <Pressable style={[styles.button, off && styles.buttonOff]} onPress={onPress} disabled={off}>
      {busy ? <ActivityIndicator /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0b0b0c" },
  content: { padding: 20, gap: 12 },
  card: { backgroundColor: "#151517", borderRadius: 12, padding: 16, gap: 6 },
  label: { color: "#8a8a8f", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  mono: { color: "#e8e8ea", fontFamily: "Menlo", fontSize: 13 },
  button: { backgroundColor: "#1f6feb", borderRadius: 10, padding: 16, alignItems: "center" },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: "white", fontWeight: "600" },
  logLine: { color: "#a0a0a6", fontFamily: "Menlo", fontSize: 11, lineHeight: 16 },
});
