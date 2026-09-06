import { useCallback, useEffect, useMemo, useState } from "react";
import { FlashList } from "@shopify/flash-list";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useArcAccount } from "../src/ui/useArcAccount.ts";
import { useMandate } from "../src/ui/useMandate.ts";
import { MandateCard } from "../src/ui/MandateCard.tsx";
import { Button } from "../src/ui/Button.tsx";
import { GrantForm } from "../src/ui/GrantForm.tsx";
import { IconButton } from "../src/ui/IconButton.tsx";
import type { Choice } from "../src/ui/ChoiceRow.tsx";
import { Label } from "../src/ui/Label.tsx";
import { Note } from "../src/ui/Note.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { grantSummary } from "../src/ui/grant-format.ts";
import { readGrantTerms } from "../src/ui/grant-terms.ts";
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
  const [amount, setAmount] = useState<string>(DEFAULT_AMOUNT);
  const [amountCustom, setAmountCustom] = useState(false);
  const [days, setDays] = useState<string>(DEFAULT_DAYS);
  const [daysCustom, setDaysCustom] = useState(false);
  /**
   * Bumped when a grant clears the form, to remount the address field.
   *
   * `Field` shows its problem once touched, so that clearing it says why rather than silently
   * dimming the button. But a grant clears the field too, and the field cannot tell the app doing
   * that from the person doing it — so a successful grant left the form announcing that the empty
   * address is invalid. A new key says "this is a fresh form", which is exactly what happened.
   */
  const [formGeneration, setFormGeneration] = useState(0);

  /**
   * An address handed back by the scanner.
   *
   * The scan screen replaces this one rather than stacking on it, so the address arrives as a
   * route parameter instead of through a callback. Cleared once taken, or navigating back here
   * later would silently refill a field the person had emptied on purpose.
   */
  const scanned = useLocalSearchParams<{ agent?: string }>().agent;
  useEffect(() => {
    if (scanned === undefined) return;
    setAgent(scanned);
    router.setParams({ agent: undefined });
  }, [scanned]);

  const busy = wallet.busy || mandate.busy;
  const c = useTheme().color;

  /**
   * One read of the form, used by the summary, the field messages, the button's enabled state and
   * the grant itself. They previously each decided for themselves and disagreed about the expiry
   * in the dangerous direction — see `readGrantTerms`.
   */
  const read = useMemo(() => readGrantTerms({ agent, amount, days }), [agent, amount, days]);
  const terms = "terms" in read ? read.terms : null;
  const problems = "problems" in read ? read.problems : NO_PROBLEMS;

  /**
   * Built from the terms that would actually be granted, never from a parallel set held for
   * display. The sentence directly above the button is the one place that must not lie.
   */
  const summary = useMemo(
    () => (terms === null ? null : grantSummary({ limit: terms.limit, days: terms.days })),
    [terms],
  );

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
    if (terms === null) return;
    mandate.grant({
      agent: terms.agent,
      limit: terms.limit,
      payees: [],
      expiresAt: Math.floor(Date.now() / 1000) + Math.round(terms.days * 86_400),
      label: "agent",
    });
    setAgent("");
    setFormGeneration((n) => n + 1);
  }, [terms, mandate]);

  const canGrant = terms !== null && !busy && mandate.ready === true;

  const header = (
    <View style={styles.header}>
      {wallet.account ? (
        <Surface raised>
          <Label>Your Wallet</Label>
          <Text style={[styles.balance, { color: c.paper }]}>{wallet.balance?.format(2) ?? "—"}</Text>
          <Text style={[styles.mono, { color: c.dim }]}>{wallet.account.address}</Text>
        </Surface>
      ) : (
        <Surface raised>
          <Label>No Wallet Yet</Label>
          <Button tier="solid" title="Create a Wallet" onPress={wallet.create} busy={busy} />
          <Button title="Use an Existing Passkey" onPress={wallet.signIn} busy={busy} />
        </Surface>
      )}

      {wallet.error !== null && <Note tone="warn" lines={ERROR_LINES}>{wallet.error}</Note>}
      {mandate.error !== null && <Note tone="warn" lines={ERROR_LINES}>{mandate.error}</Note>}

      {wallet.account !== null && (
        <GrantForm
          agent={agent}
          onAgent={setAgent}
          amount={amount}
          onAmount={(next) => { setAmount(next); setAmountCustom(false); }}
          days={days}
          onDays={(next) => { setDays(next); setDaysCustom(false); }}
          amountCustom={amountCustom}
          onAmountCustom={() => setAmountCustom(true)}
          daysCustom={daysCustom}
          onDaysCustom={() => setDaysCustom(true)}
          amounts={AMOUNTS}
          windows={WINDOWS}
          problems={problems}
          summary={summary}
          canGrant={canGrant}
          busy={busy}
          onGrant={grant}
          notice={mandate.ready === false ? "Not deployed to Arc testnet yet" : null}
          resetKey={formGeneration}
          addressAction={
            <IconButton
              icon="qr-code-outline"
              size={tokens.size.control.hint}
              onPress={() => router.push("/scan")}
              label="Scan the agent's code"
              hint="Read a pairing code the agent printed, instead of typing its address"
            />
          }
        />
      )}

      {mandate.mandates.length > 0 && <Label>Active Allowances</Label>}
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
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    />
  );
}

// Module scope: defined inside the component these would be new references every render, and the
// list would treat every row as changed.
const keyOfMandate = (item: Mandate) => item.agent;

/**
 * The presets, as strings, because that is what the field beneath them edits.
 *
 * Keeping one representation means picking a pill and typing a number are the same state, so the
 * custom field opens on whatever was last chosen instead of blank.
 */
const AMOUNTS: readonly Choice<string>[] = [
  { label: "5", value: "5" },
  { label: "20", value: "20" },
  { label: "100", value: "100" },
];
const WINDOWS: readonly Choice<string>[] = [
  { label: "1 day", value: "1" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
];
const DEFAULT_AMOUNT = "20";
const DEFAULT_DAYS = "7";

/** Nothing to complain about yet, and the same shape the reader returns. */
/** Enough of a chain error to recognise it; the harness log has the whole thing. */
const ERROR_LINES = 3;

const NO_PROBLEMS = { agent: null, amount: null, days: null } as const;


const styles = StyleSheet.create({
  content: { padding: tokens.space.lg, gap: tokens.space.md },
  header: { gap: tokens.space.md, paddingBottom: tokens.space.xs },
  balance: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.display,
    fontWeight: "700",
    letterSpacing: tokens.font.displayTracking,
    // Re-read every ten seconds; proportional digits would change width on every update.
    fontVariant: [...tokens.font.tabular],
  },
  mono: { fontFamily: tokens.font.mono, fontSize: tokens.font.small },
});
