import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import type { Activity } from "../src/arc/activity.ts";
import { ActivityRow } from "../src/ui/ActivityRow.tsx";
import { activityRowText } from "../src/ui/activity-format.ts";
import { AgentRow } from "../src/ui/AgentRow.tsx";
import { AllowanceCard } from "../src/ui/AllowanceCard.tsx";
import { Button } from "../src/ui/Button.tsx";
import { Field } from "../src/ui/Field.tsx";
import { Label } from "../src/ui/Label.tsx";
import { MandateCard } from "../src/ui/MandateCard.tsx";
import { NetworkSwitch } from "../src/ui/NetworkSwitch.tsx";
import { AlreadyGranted } from "../src/ui/AlreadyGranted.tsx";
import { Note } from "../src/ui/Note.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { grantSummary } from "../src/ui/grant-format.ts";
import { Amount } from "../src/arc/amount.ts";
import { tokens } from "../src/ui/tokens.ts";
import { useTheme } from "../src/ui/theme-context.tsx";
import type { Mandate } from "../src/arc/mandate.ts";

/**
 * Every control, in every state, on one screen.
 *
 * Screens that only render once a wallet exists can only be looked at after a passkey ceremony, so
 * in practice nobody looked at them. A control whose broken state is three steps behind a ceremony is
 * a control that ships broken.
 *
 * This is a catalogue of the real components with fixed inputs, not stand-ins for them. Nothing
 * here reimplements a control or fakes what one does; it renders the same `Field`, `AllowanceCard` and
 * `Note` the product screens render, at the states that are otherwise hard to reach. When one of
 * them is wrong, it is wrong here too.
 *
 * Reachable from Settings, alongside the chain harness, and not part of the product.
 */
export default function PreviewScreen() {
  const c = useTheme().color;
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(MONAD_TESTNET);

  return (
    <ScrollView
      style={[styles.page, { backgroundColor: c.groundMid }]}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
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
        <Note>{grantSummary({ limit: Amount.parse("20"), days: 7, network: ARC_TESTNET, now: FIXED_NOW })}</Note>
        <Note>{grantSummary({ limit: Amount.parse("5"), days: null, network: ARC_TESTNET, now: FIXED_NOW })}</Note>
        <Note>{grantSummary({ limit: Amount.parse("0.005"), days: 7, network: MONAD_TESTNET, now: FIXED_NOW })}</Note>
        <Note tone="warn">Not deployed to Arc testnet yet</Note>
      </Surface>

      <Label>Already granted · what a scan of an agent this wallet grants says</Label>
      <Surface>
        <AlreadyGranted onOpen={NOOP} />
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
        <AgentRow network={ARC_TESTNET} mandate={HALF_SPENT} name="Scout" onPress={NOOP} first />
        <AgentRow network={ARC_TESTNET} mandate={FRESH} name={null} onPress={NOOP} first={false} />
        <AgentRow network={ARC_TESTNET} mandate={NEARLY_SPENT} name="Research agent" onPress={NOOP} first={false} />
        <AgentRow network={ARC_TESTNET} mandate={EXPIRED} name="Old scraper" onPress={NOOP} first={false} />
      </Surface>

      <Label>Activity rows · across agents, then one agent</Label>
      <Surface style={styles.group}>
        {ACTIVITY.map((item, index) => {
          const text = activityRowText(item, { name: index === 0 ? "Scout" : null, withAgent: true, underDayHeading: false });
          return <ActivityRow key={item.tx} network={ARC_TESTNET} item={item} text={text} onPress={NOOP} first={index === 0} />;
        })}
      </Surface>
      <Surface style={styles.group}>
        {ACTIVITY.map((item, index) => {
          const text = activityRowText(item, { name: null, withAgent: false, underDayHeading: false });
          return <ActivityRow key={item.tx} network={ARC_TESTNET} item={item} text={text} onPress={NOOP} first={index === 0} />;
        })}
      </Surface>

      {/*
        The same wallet on Monad: figures in MON at the precision they were granted, and the payment
        the connector's proof made there on 3 Oct, so its receipt link goes somewhere true.
      */}
      <Label>Network switch</Label>
      <NetworkSwitch networks={[ARC_TESTNET, MONAD_TESTNET]} selected={shown} onSelect={setShown} />

      {/* The card each allowance is issued as: on Monad with everything an app's code can carry, and on Arc with only what the person typed. */}
      <Label>Allowance card · Monad, asked by an app</Label>
      <AllowanceCard face={{
        network: MONAD_TESTNET, limit: Amount.parse("0.01"), agent: "0x806dC09Fc68509E77B5909f88f2A934b3D2852E5",
        name: "Runner", ends: "11 Oct", askedBy: "A test app", payees: ["0xc831b6e4414E064F7713A3b6017be4a1Eb9F5E9b"],
        calls: [{ contract: "0xc831b6e4414E064F7713A3b6017be4a1Eb9F5E9b", functions: ["join(uint256)", "submit(uint256,bytes32)"] }],
        spoken: "Runner can spend up to 0.01 MON until 11 Oct.",
      }} />
      <Label>Allowance card · Arc, typed by hand</Label>
      <AllowanceCard face={{
        network: ARC_TESTNET, limit: Amount.parse("20"), agent: GOOD_ADDRESS, name: null, ends: null, askedBy: null, payees: [], calls: [],
        spoken: "This agent can spend up to 20.00 USDC with no end date.",
      }} />

      <Label>On Monad · agent rows, a payment, a card</Label>
      <Surface style={styles.group}>
        <AgentRow network={MONAD_TESTNET} mandate={MONAD_SPENT} name="Runner" onPress={NOOP} first />
        <AgentRow network={MONAD_TESTNET} mandate={MONAD_FRESH} name={null} onPress={NOOP} first={false} />
      </Surface>
      <Surface style={styles.group}>
        {MONAD_ACTIVITY.map((item, index) => {
          const text = activityRowText(item, { name: "Runner", withAgent: true, underDayHeading: false });
          return <ActivityRow key={item.tx} network={MONAD_TESTNET} item={item} text={text} onPress={NOOP} first={index === 0} />;
        })}
      </Surface>
      <MandateCard network={MONAD_TESTNET} mandate={MONAD_SPENT} onRevoke={NOOP} busy={false} />

      <Label>Mandate card</Label>
      <View style={styles.cards}>
        <MandateCard network={ARC_TESTNET} mandate={FRESH} onRevoke={NOOP} busy={false} />
        <MandateCard network={ARC_TESTNET} mandate={HALF_SPENT} onRevoke={NOOP} busy={false} />
        <MandateCard network={ARC_TESTNET} mandate={EXPIRED} onRevoke={NOOP} busy={false} />
        <MandateCard network={ARC_TESTNET} mandate={WITH_DUST} onRevoke={NOOP} busy={false} />
        <MandateCard network={ARC_TESTNET} mandate={BARELY_SPENT} onRevoke={NOOP} busy={false} />
        <MandateCard network={ARC_TESTNET} mandate={NEARLY_SPENT} onRevoke={NOOP} busy={false} />
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


const sample = (limit: string, spent: string, expiresAt?: number, agentFloat = Amount.ZERO, lastUsedAt: number | null = null): Mandate => {
  const l = Amount.parse(limit);
  const s = Amount.parse(spent);
  return {
    agent: GOOD_ADDRESS,
    limit: l,
    spent: s,
    remaining: s.compare(l) >= 0 ? Amount.ZERO : l.subtract(s),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    agentFloat,
    escrow: Amount.ZERO,
    lastUsedAt,
    rail: "erc20",
  };
};

const FRESH = sample("50", "0", NOW_SECONDS() + 7 * 86_400);
const HALF_SPENT = sample("50", "25", NOW_SECONDS() + 86_400, Amount.ZERO, NOW_SECONDS() - 300);
const EXPIRED = sample("50", "50", NOW_SECONDS() - 86_400);
/** Left over from when a grant sent the agent a float. Should not happen to a new mandate. */
const WITH_DUST = sample("50", "10", NOW_SECONDS() + 3 * 86_400, Amount.parse("0.5"));
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
    kind: "draw", agent: FEED_AGENT, amount: Amount.parse("0.001"), at: NOW_SECONDS() - 120, block: 61_444_111n,
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

/** The connector's proof on Monad, 3 Oct: a 0.01 MON allowance, and 0.002 of it paid. */
const MONAD_SPENT: Mandate = { ...sample("0.01", "0.002", NOW_SECONDS() + 7 * 86_400, Amount.ZERO, NOW_SECONDS() - 600), rail: "native" };
const MONAD_FRESH: Mandate = { ...sample("0.005", "0"), rail: "native" };
const MONAD_ACTIVITY: readonly Activity[] = [
  {
    kind: "paid", agent: "0x806dC09Fc68509E77B5909f88f2A934b3D2852E5", amount: Amount.parse("0.002"),
    to: "0x9C1a07dCf5B8c1Da6025d84754Bb3a7d3345f281", call: 0, at: NOW_SECONDS() - 600, block: 68_026_961n,
    tx: "0x3171bcea1d331bcdac3117679190eab2fa7e334502b88d4362353028341765be", logIndex: 7,
  },
  {
    kind: "registered", agent: "0x948c0177445FE0F9998b989529171Bf08D834E0A", amount: null, identity: 1997n,
    at: NOW_SECONDS() - 900, block: 68_027_775n,
    tx: "0x51fe47cf7023b40473deb5e42a4ed535a5e4b44d3eb50029056028326df7822d", logIndex: 2,
  },
];

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: tokens.space.lg, gap: tokens.space.md },
  cards: { gap: tokens.space.md },
  group: { padding: 0, gap: 0, overflow: "hidden" },
});
