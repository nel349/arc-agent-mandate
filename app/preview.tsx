import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../src/ui/Button.tsx";
import { ChoiceRow } from "../src/ui/ChoiceRow.tsx";
import { Field } from "../src/ui/Field.tsx";
import { Label } from "../src/ui/Label.tsx";
import { MandateCard } from "../src/ui/MandateCard.tsx";
import { Note } from "../src/ui/Note.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { grantSummary } from "../src/ui/grant-format.ts";
import { Usdc } from "../src/arc/usdc.ts";
import { tokens } from "../src/ui/tokens.ts";
import { useTheme } from "../src/ui/theme-context.tsx";
import type { Mandate } from "../src/arc/mandate.ts";

/**
 * Every control, in every state, on one screen.
 *
 * The grant form only renders once a wallet exists, which meant the only way to look at it was to
 * complete a passkey ceremony first — so in practice nobody looked at it, including me. A control
 * whose broken state is three steps behind a ceremony is a control that ships broken.
 *
 * This is a catalogue of the real components with fixed inputs, not stand-ins for them. Nothing
 * here reimplements a control or fakes what one does; it renders the same `Field`, `ChoiceRow` and
 * `Note` the product screen renders, at the states that are otherwise hard to reach. When one of
 * them is wrong, it is wrong here too.
 *
 * Reachable from Settings, alongside the chain harness, and not part of the product.
 */
export default function PreviewScreen() {
  const c = useTheme().color;
  const [amount, setAmount] = useState("20");
  const [custom, setCustom] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <ScrollView
      style={[styles.page, { backgroundColor: c.groundMid }]}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Label>Choice row · preset chosen</Label>
      <Surface>
        <ChoiceRow
          label="Amount · USDC"
          hint="The total this agent may ever spend."
          options={AMOUNTS}
          selected={amount}
          onSelect={(next) => { setAmount(next); setCustom(false); }}
          custom={{
            active: custom,
            onSelect: () => setCustom(true),
            children: (
              <Field
                label="Amount"
                value={amount}
                onChangeText={setAmount}
                placeholder="10"
                keyboardType="decimal-pad"
              />
            ),
          }}
        />
      </Surface>

      <Label>Field · the three states</Label>
      <Surface>
        <Field
          label="Empty"
          value=""
          onChangeText={NOOP}
          placeholder="0x…"
          hint="Quiet until there is something to judge."
        />
        <Field
          label="Accepted"
          value={GOOD_ADDRESS}
          onChangeText={NOOP}
          problem={null}
          confirmed
        />
        <Field
          label="Rejected"
          value="0xnope"
          onChangeText={NOOP}
          problem="That is not a valid address. It starts 0x and is 42 characters long."
        />
        <Field
          label="Live"
          value={typed}
          onChangeText={setTyped}
          placeholder="type here"
          hint="Edit this one to watch the border and the message change."
          problem={typed.length > 0 && typed.length < 4 ? "Keep going — at least four characters." : null}
          confirmed={typed.length >= 4}
        />
      </Surface>

      <Label>Note</Label>
      <Surface>
        <Note>{grantSummary({ limit: Usdc.parse("20"), days: 7, now: FIXED_NOW })}</Note>
        <Note>{grantSummary({ limit: Usdc.parse("5"), days: null, now: FIXED_NOW })}</Note>
        <Note tone="warn">Not deployed to Arc testnet yet</Note>
      </Surface>

      <Label>Button · both tiers, and off</Label>
      <Surface>
        <Button tier="solid" title="Grant Allowance" onPress={NOOP} />
        <Button title="Use an Existing Passkey" onPress={NOOP} />
        <Button tier="solid" title="Working" onPress={NOOP} busy />
        <Button tier="solid" title="Not Ready" onPress={NOOP} disabled />
      </Surface>

      <Label>Mandate card</Label>
      <View style={styles.cards}>
        <MandateCard mandate={FRESH} onRevoke={NOOP} busy={false} />
        <MandateCard mandate={HALF_SPENT} onRevoke={NOOP} busy={false} />
        <MandateCard mandate={EXPIRED} onRevoke={NOOP} busy={false} />
        <MandateCard mandate={WITH_DUST} onRevoke={NOOP} busy={false} />
      </View>
    </ScrollView>
  );
}

const NOOP = () => {};
const GOOD_ADDRESS = "0x68c91fb4f4e7f0236fd68c7d2605b5740787b17e";

/**
 * Fixed only where fixing it works.
 *
 * The summary takes an explicit `now`, so its date is stable. The mandate cards do not: they read
 * the clock themselves through `expiryLabel`, so an expiry pinned to a wall-clock date drifts —
 * two screenshots an hour apart read "5h left" and "4h left", and eventually every card says
 * "expired". Card fixtures are therefore expressed as offsets from *now*, which is what a
 * catalogue actually wants. Evaluated once when the module loads, so the three states hold for
 * the life of the app rather than literally forever — enough for looking at a screen, and honest
 * about what it is.
 */
const FIXED_NOW = Date.UTC(2026, 8, 4, 12);
const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

const AMOUNTS = [
  { label: "5", value: "5" },
  { label: "20", value: "20" },
  { label: "100", value: "100" },
] as const;

const sample = (limit: string, spent: string, expiresAt?: number, agentFloat = Usdc.ZERO): Mandate => {
  const l = Usdc.parse(limit);
  const s = Usdc.parse(spent);
  return {
    agent: GOOD_ADDRESS,
    limit: l,
    spent: s,
    remaining: s.compare(l) >= 0 ? Usdc.ZERO : l.subtract(s),
    expiresAt,
    agentFloat,
  };
};

const FRESH = sample("50", "0", NOW_SECONDS() + 7 * 86_400);
const HALF_SPENT = sample("50", "25", NOW_SECONDS() + 86_400);
const EXPIRED = sample("50", "50", NOW_SECONDS() - 86_400);
/** Left over from when a grant sent the agent a float. Should not happen to a new mandate. */
const WITH_DUST = sample("50", "10", NOW_SECONDS() + 3 * 86_400, Usdc.parse("0.5"));

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: tokens.space.lg, gap: tokens.space.md },
  cards: { gap: tokens.space.md },
});
