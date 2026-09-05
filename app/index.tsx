import { useCallback, useState } from "react";
import { FlashList } from "@shopify/flash-list";
import { StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { isAddress, type Address } from "viem";
import { useArcAccount } from "../src/ui/useArcAccount.ts";
import { useMandate } from "../src/ui/useMandate.ts";
import { MandateCard } from "../src/ui/MandateCard.tsx";
import { Button } from "../src/ui/Button.tsx";
import { Field } from "../src/ui/Field.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { Usdc } from "../src/arc/usdc.ts";
import { tokens } from "../src/ui/tokens.ts";
import { useTheme } from "../src/ui/theme-context.tsx";
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
  const c = useTheme().color;

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
      // Authorising an agent that cannot pay to submit is authorising nothing. This goes in the
      // same user operation, so it is one confirmation and the two can never come apart.
      gasFloat: GAS_FLOAT,
      expiresAt: Number.isFinite(window) && window > 0
        ? Math.floor(Date.now() / 1000) + Math.round(window * 86_400)
        : undefined,
      label: "agent",
    });
    setAgent("");
  }, [agent, amount, days, mandate]);

  const canGrant = isAddress(agent) && !busy && mandate.ready === true;

  const header = (
    <View style={styles.header}>
      {wallet.account ? (
        <Surface raised>
          <Text style={[styles.label, { color: c.muted }]}>Your Wallet</Text>
          <Text style={[styles.balance, { color: c.paper }]}>{wallet.balance?.format(2) ?? "—"}</Text>
          <Text style={[styles.mono, { color: c.dim }]}>{wallet.account.address}</Text>
        </Surface>
      ) : (
        <Surface raised>
          <Text style={[styles.label, { color: c.muted }]}>No Wallet Yet</Text>
          <Button tier="solid" title="Create a Wallet" onPress={wallet.create} busy={busy} />
          <Button title="Use an Existing Passkey" onPress={wallet.signIn} busy={busy} />
        </Surface>
      )}

      {wallet.error !== null && (
        <Text style={[styles.error, { color: c.warn }]} numberOfLines={3}>{wallet.error}</Text>
      )}
      {mandate.error !== null && (
        <Text style={[styles.error, { color: c.warn }]} numberOfLines={3}>{mandate.error}</Text>
      )}
      {mandate.ready === false && (
        <Surface>
          <Text style={[styles.label, { color: c.warn }]}>Not available yet</Text>
          <Text style={[styles.empty, { color: c.muted }]}>
            The allowance contract has not been deployed to Arc testnet. Granting will work as soon
            as it is — everything else on this screen already does.
          </Text>
        </Surface>
      )}

      {wallet.account !== null && (
        <Surface>
          <Text style={[styles.label, { color: c.muted }]}>Give an Agent an Allowance</Text>
          <Field
            label="Agent address"
            value={agent}
            onChangeText={setAgent}
            placeholder="0x…"
            hint="Ask your agent for its address — it prints one on first run."
          />
          <Field
            label="Amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="10"
            hint="USDC. The agent can never spend more than this."
            keyboardType="decimal-pad"
          />
          <Field
            label="Expires after"
            value={days}
            onChangeText={setDays}
            placeholder="7"
            hint="Days. The allowance stops working on its own."
            keyboardType="decimal-pad"
          />
          <Button
            tier="solid"
            title="Grant Allowance"
            onPress={grant}
            busy={busy}
            disabled={!canGrant}
          />
        </Surface>
      )}

      {mandate.mandates.length > 0 && <Text style={[styles.label, { color: c.muted }]}>Active Allowances</Text>}
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

/** Enough for roughly 350 payments at the measured ~0.0014 USDC per submission. */
const GAS_FLOAT = Usdc.parse("0.5");

// Components rather than elements: an element built at module scope would evaluate `styles`
// before the StyleSheet below it exists.
function EmptyState() {
  // Reads the theme like everything else. Defined at module scope it cannot close over the
  // screen's colours, and without them it renders in the default black — which on this ground is
  // invisible rather than merely wrong.
  const c = useTheme().color;
  return (
    <Text style={[styles.empty, { color: c.muted }]}>
      No agent has an allowance yet. Run the connector, ask your agent for its address, and paste
      it above.
    </Text>
  );
}

function Footer() {
  const c = useTheme().color;
  return (
    <View style={styles.footer}>
      <Link href="/settings" style={[styles.footLink, { color: c.signal }]}>Settings</Link>
      <Link href="/dev" style={[styles.footLink, { color: c.muted }]}>Developer harness</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: tokens.space.lg, gap: tokens.space.md },
  header: { gap: tokens.space.md, paddingBottom: tokens.space.xs },
  label: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.label,
    letterSpacing: tokens.font.labelTracking,
    textTransform: "uppercase",
  },
  balance: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.display,
    fontWeight: "700",
    letterSpacing: -1,
    // Re-read every ten seconds; proportional digits would change width on every update.
    fontVariant: [...tokens.font.tabular],
  },
  mono: { fontFamily: tokens.font.mono, fontSize: tokens.font.small },
  error: { fontFamily: tokens.font.mono, fontSize: tokens.font.small },
  empty: { fontFamily: tokens.font.mono, fontSize: tokens.font.small, lineHeight: 18 },
  footer: { flexDirection: "row", gap: tokens.space.lg, marginTop: tokens.space.lg },
  footLink: { fontFamily: tokens.font.mono, fontSize: tokens.font.small },
});
