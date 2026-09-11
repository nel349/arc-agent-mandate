import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { Activity } from "../src/arc/activity.ts";
import { ActivityRow } from "../src/ui/ActivityRow.tsx";
import { activityRowText } from "../src/ui/activity-format.ts";
import { AgentRow } from "../src/ui/AgentRow.tsx";
import { Button } from "../src/ui/Button.tsx";
import { ChoiceRow } from "../src/ui/ChoiceRow.tsx";
import { Field } from "../src/ui/Field.tsx";
import { GrantForm } from "../src/ui/GrantForm.tsx";
import { readGrantTerms } from "../src/ui/grant-terms.ts";
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
  // The completed form above, kept live so it can be poked at rather than only looked at.
  const [filledAgent, setFilledAgent] = useState(GOOD_ADDRESS);
  const [filledAmount, setFilledAmount] = useState("37.50");
  const [filledDays, setFilledDays] = useState("14");
  const [filledAmountCustom, setFilledAmountCustom] = useState(true);
  const [filledDaysCustom, setFilledDaysCustom] = useState(true);
  const filled = { agent: filledAgent, amount: filledAmount, days: filledDays };
  const read = readGrantTerms(filled);
  const filledRead = {
    problems: "problems" in read ? read.problems : NO_PROBLEMS,
    summary: "terms" in read
      ? grantSummary({ limit: read.terms.limit, days: read.terms.days, now: FIXED_NOW })
      : null,
  };

  const [amount, setAmount] = useState("20");
  const [custom, setCustom] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <ScrollView
      style={[styles.page, { backgroundColor: c.groundMid }]}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      {/*
        The whole form, filled in, using the component the screen uses.

        This is the state that was unreachable: the form only renders once a wallet exists, so on a
        simulator without a passkey nobody could look at a completed one — a confirmed address, a
        custom amount open, the live summary, an enabled button.
      */}
      <Label>Grant form · everything filled in</Label>
      <GrantForm
        agent={filled.agent}
        onAgent={setFilledAgent}
        amount={filled.amount}
        onAmount={(next) => { setFilledAmount(next); setFilledAmountCustom(false); }}
        days={filled.days}
        onDays={(next) => { setFilledDays(next); setFilledDaysCustom(false); }}
        amountCustom={filledAmountCustom}
        onAmountCustom={() => setFilledAmountCustom(true)}
        daysCustom={filledDaysCustom}
        onDaysCustom={() => setFilledDaysCustom(true)}
        amounts={AMOUNTS}
        windows={WINDOWS}
        problems={filledRead.problems}
        summary={filledRead.summary}
        canGrant={filledRead.summary !== null}
        busy={false}
        onGrant={NOOP}
        notice={null}
        resetKey={0}
      />

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
          problem={typed.length > 0 && typed.length < 4 ? "Keep going. At least four characters." : null}
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

      <Label>Agent rows · named, unnamed, nearly out, ended</Label>
      <Surface style={styles.group}>
        <AgentRow mandate={HALF_SPENT} name="Maze runner" onPress={NOOP} first />
        <AgentRow mandate={FRESH} name={null} onPress={NOOP} first={false} />
        <AgentRow mandate={NEARLY_SPENT} name="Research agent" onPress={NOOP} first={false} />
        <AgentRow mandate={EXPIRED} name="Old scraper" onPress={NOOP} first={false} />
      </Surface>

      <Label>Activity rows · across agents, then one agent</Label>
      <Surface style={styles.group}>
        {ACTIVITY.map((item, index) => {
          const text = activityRowText(item, { name: index === 0 ? "Maze runner" : null, withAgent: true, underDayHeading: false });
          return <ActivityRow key={item.tx} item={item} text={text} onPress={NOOP} first={index === 0} />;
        })}
      </Surface>
      <Surface style={styles.group}>
        {ACTIVITY.map((item, index) => {
          const text = activityRowText(item, { name: null, withAgent: false, underDayHeading: false });
          return <ActivityRow key={item.tx} item={item} text={text} onPress={NOOP} first={index === 0} />;
        })}
      </Surface>

      <Label>Mandate card</Label>
      <View style={styles.cards}>
        <MandateCard mandate={FRESH} onRevoke={NOOP} busy={false} />
        <MandateCard mandate={HALF_SPENT} onRevoke={NOOP} busy={false} />
        <MandateCard mandate={EXPIRED} onRevoke={NOOP} busy={false} />
        <MandateCard mandate={WITH_DUST} onRevoke={NOOP} busy={false} />
        <MandateCard mandate={BARELY_SPENT} onRevoke={NOOP} busy={false} />
        <MandateCard mandate={NEARLY_SPENT} onRevoke={NOOP} busy={false} />
      </View>
    </ScrollView>
  );
}

const NOOP = () => {};
/** Nothing to complain about, and the shape the reader returns. */
const NO_PROBLEMS = { agent: null, amount: null, days: null } as const;
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
const WINDOWS = [
  { label: "1 day", value: "1" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
] as const;

const sample = (limit: string, spent: string, expiresAt?: number, agentFloat = Usdc.ZERO, lastUsedAt: number | null = null): Mandate => {
  const l = Usdc.parse(limit);
  const s = Usdc.parse(spent);
  return {
    agent: GOOD_ADDRESS,
    limit: l,
    spent: s,
    remaining: s.compare(l) >= 0 ? Usdc.ZERO : l.subtract(s),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    agentFloat,
    lastUsedAt,
    rail: "erc20",
  };
};

const FRESH = sample("50", "0", NOW_SECONDS() + 7 * 86_400);
const HALF_SPENT = sample("50", "25", NOW_SECONDS() + 86_400, Usdc.ZERO, NOW_SECONDS() - 300);
const EXPIRED = sample("50", "50", NOW_SECONDS() - 86_400);
/** Left over from when a grant sent the agent a float. Should not happen to a new mandate. */
const WITH_DUST = sample("50", "10", NOW_SECONDS() + 3 * 86_400, Usdc.parse("0.5"));
/** The two ends rounding could lie about: a little spent must not read as none, and nearly all as all. */
const BARELY_SPENT = sample("50", "0.01", NOW_SECONDS() + 5 * 86_400);
const NEARLY_SPENT = sample("50", "49.99", NOW_SECONDS() + 86_400);

/**
 * One of each kind of row, offsets from now like the cards, with the real draw's amount and
 * transaction from Arc on 09-10 so the receipt link goes somewhere true.
 */
const FEED_AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const ACTIVITY: readonly Activity[] = [
  {
    kind: "draw", agent: FEED_AGENT, amount: Usdc.parse("0.001"), at: NOW_SECONDS() - 120, block: 61_444_111n,
    tx: "0xa358110f8d264214723dd48a578bd84e6fe0880eedf7600861be58130069d6d3", logIndex: 4,
  },
  {
    kind: "granted", agent: FEED_AGENT, amount: null, at: NOW_SECONDS() - 86_400, block: 61_300_000n,
    tx: `0x${"2".repeat(64)}`, logIndex: 0,
  },
  {
    kind: "revoked", agent: FEED_AGENT, amount: null, at: NOW_SECONDS() - 3 * 86_400, block: 61_000_000n,
    tx: `0x${"3".repeat(64)}`, logIndex: 0,
  },
];

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: tokens.space.lg, gap: tokens.space.md },
  cards: { gap: tokens.space.md },
  group: { padding: 0, gap: 0, overflow: "hidden" },
});
