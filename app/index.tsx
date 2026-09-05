import { useCallback, useState } from "react";
import { FlashList } from "@shopify/flash-list";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { isAddress, type Address } from "viem";
import { useArcAccount } from "../src/ui/useArcAccount.ts";
import { useMandate } from "../src/ui/useMandate.ts";
import { MandateCard } from "../src/ui/MandateCard.tsx";
import { Button } from "../src/ui/Button.tsx";
import { Usdc } from "../src/arc/usdc.ts";
import { tokens } from "../src/ui/tokens.ts";
import type { Mandate } from "../src/arc/mandate.ts";

/**
 * The product: your wallet, what you have let agents spend, and taking it back.
 *
 * The allowances are the list, and the wallet plus the grant form are its header — one scrolling
 * surface, and the list stays virtualized as allowances accumulate.
 */
export default function AllowancesScreen() {
  const wallet = useArcAccount();
  const mandate = useMandate(wallet.account);
  const [agent, setAgent] = useState("");
  const [amount, setAmount] = useState("10");
  const [days, setDays] = useState("7");

  const busy = wallet.busy || mandate.busy;

  /**
   * The agent's address arrives by paste today. It is a public value the agent prints, so a QR
   * scan is a convenience rather than a different flow, and is not worth a camera permission
   * until the rest of this is on a device.
   */
  /**
   * An allowance bounds **how much and for how long**, not who.
   *
   * Requiring payees up front cannot work: an agent shopping the open web does not know who it
   * will pay until it finds a service, and neither does the person granting. Counterparty
   * scoping stays available in the SDK for when you genuinely do know, and an agent refused for
   * an unknown payee says so in the conversation — which is where the person already is.
   */
  const grant = useCallback(() => {
    if (!isAddress(agent)) return;
    let limit: Usdc;
    try {
      limit = Usdc.parse(amount);
    } catch {
      return;
    }
    const window = Number(days);
    mandate.grant({
      agent,
      limit,
      payees: [],
      expiresAt: Number.isFinite(window) && window > 0
        ? Math.floor(Date.now() / 1000) + Math.round(window * 86_400)
        : undefined,
      label: "agent",
    });
    setAgent("");
  }, [agent, amount, days, mandate]);

  const canGrant = isAddress(agent) && !busy;

  const header = (
    <View style={styles.header}>
      {wallet.account ? (
        <View style={styles.card}>
          <Text style={styles.label}>your wallet</Text>
          <Text style={styles.balance}>{wallet.balance?.format(2) ?? "—"}</Text>
          <Text style={styles.mono}>{wallet.account.address}</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>no wallet yet</Text>
          <Button tier="solid" title="Create one with Face ID" onPress={wallet.create} busy={busy} />
          <Button title="Use an existing passkey" onPress={wallet.signIn} busy={busy} />
        </View>
      )}

      {wallet.error !== null && <Text style={styles.error}>{wallet.error}</Text>}
      {mandate.error !== null && <Text style={styles.error}>{mandate.error}</Text>}

      {wallet.account !== null && (
        <View style={styles.card}>
          <Text style={styles.label}>give an agent an allowance</Text>
          <TextInput
            style={styles.input}
            value={agent}
            onChangeText={setAgent}
            placeholder="agent address (0x…)"
            placeholderTextColor={tokens.color.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="amount in USDC"
            placeholderTextColor={tokens.color.textMuted}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={styles.input}
            value={days}
            onChangeText={setDays}
            placeholder="days until it expires"
            placeholderTextColor={tokens.color.textMuted}
            keyboardType="decimal-pad"
          />
          <Button
            tier="solid"
            title={`Grant ${amount} USDC for ${days} days`}
            onPress={grant}
            busy={busy}
            disabled={!canGrant}
          />
        </View>
      )}

      {mandate.mandates.length > 0 && <Text style={styles.label}>active allowances</Text>}
    </View>
  );

  const renderMandate = useCallback(
    ({ item }: { item: Mandate }) => (
      <MandateCard mandate={item} onRevoke={mandate.revoke} busy={busy} />
    ),
    [mandate.revoke, busy],
  );

  return (
    <FlashList
      data={mandate.mandates}
      renderItem={renderMandate}
      keyExtractor={keyOfMandate}
      ListHeaderComponent={header}
      ListEmptyComponent={wallet.account !== null ? EmptyState : null}
      ListFooterComponent={Footer}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    />
  );
}

// Module scope: defined inside the component these would be new references every render, and the
// list would treat every row as changed.
const keyOfMandate = (item: Mandate) => item.agent;

// Components rather than elements: an element built at module scope would evaluate `styles`
// before the StyleSheet below it exists.
function EmptyState() {
  return (
    <Text style={styles.empty}>
      No agent has an allowance yet. Run the connector, ask your agent for its address, and paste
      it above.
    </Text>
  );
}

function Footer() {
  return <Link href="/dev" style={styles.devLink}>Developer harness</Link>;
}

const styles = StyleSheet.create({
  content: { padding: tokens.space.lg },
  header: { gap: tokens.space.md, paddingBottom: tokens.space.md },
  card: {
    backgroundColor: tokens.color.glass,
    borderWidth: tokens.border.hairline,
    borderColor: tokens.color.glassBorder,
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
  balance: { color: tokens.color.text, fontSize: tokens.font.display, fontWeight: "600" },
  mono: { color: tokens.color.textDim, fontFamily: tokens.font.mono, fontSize: tokens.font.small },
  input: {
    backgroundColor: tokens.color.background,
    borderRadius: tokens.radius.pill,
    padding: tokens.space.base,
    color: tokens.color.text,
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.body,
  },
  error: { color: tokens.color.danger, fontSize: tokens.font.small },
  empty: { color: tokens.color.textMuted, fontSize: tokens.font.body, lineHeight: 20 },
  devLink: { color: tokens.color.textMuted, fontSize: tokens.font.small, marginTop: tokens.space.lg },
});
