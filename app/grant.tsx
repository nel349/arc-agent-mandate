import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { isAddress } from "viem";
import { AgentChip } from "../src/ui/AgentChip.tsx";
import { AmountHero } from "../src/ui/AmountHero.tsx";
import { ArcRing } from "../src/ui/ArcRing.tsx";
import { Button } from "../src/ui/Button.tsx";
import { ChoiceListRow } from "../src/ui/ChoiceListRow.tsx";
import { DetailRow } from "../src/ui/DetailRow.tsx";
import { Field } from "../src/ui/Field.tsx";
import { Note } from "../src/ui/Note.tsx";
import { PresetChip } from "../src/ui/PresetChip.tsx";
import { ScanModal } from "../src/ui/ScanModal.tsx";
import { Screen } from "../src/ui/Screen.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { WizardTopBar } from "../src/ui/WizardTopBar.tsx";
import { cleanAgentName, MAX_AGENT_NAME } from "../src/ui/agent-names.ts";
import { useAgentNames } from "../src/ui/agent-names-context.tsx";
import { entryFromScan, entryFromText, mandateTermsFor } from "../src/ui/grant-entry.ts";
import { exceedsWallet, grantedSentence, grantSummary, windowEndLabel } from "../src/ui/grant-format.ts";
import { readGrantTerms } from "../src/ui/grant-terms.ts";
import { feelSuccess } from "../src/ui/haptics.ts";
import { shortAddress } from "../src/ui/mandate-format.ts";
import { useSession } from "../src/ui/session-context.tsx";
import { useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

/**
 * Giving an agent an allowance: one full screen per question, in order.
 *
 * Built the way Kuira's send wizard is. Each step owns the whole screen and asks one thing — who,
 * how much, how long — and the last shows all three as a sentence before Face ID. The amount step
 * gives the number the whole screen, with the step's Continue in the bar above it, so a person
 * types a limit into the space it deserves rather than into a field in a card.
 *
 * It used to be one form in a sheet: every question at once, stopping two thirds of the way down,
 * with the button inside the card. A flow of several steps is what Apple puts full screen.
 */
type Step = "agent" | "amount" | "window" | "review" | "done";

/** The order the steps come in. "Done" is not in it: nothing goes back to it. */
const ORDER: readonly Step[] = ["agent", "amount", "window", "review"];

const TITLES: Readonly<Record<Step, string>> = {
  agent: "Choose the agent",
  amount: "Set the limit",
  window: "Choose how long",
  review: "Review",
  done: "",
};

export default function GrantScreen() {
  const { wallet, mandate } = useSession();
  const { rename, nameOf } = useAgentNames();
  const router = useRouter();
  const c = useTheme().color;

  const [step, setStep] = useState<Step>("agent");
  const [agent, setAgent] = useState("");
  /**
   * The one-time code the agent's QR carried, written into the grant so the agent can tell this
   * allowance from any other granted to its address. Null when the address was typed.
   */
  const [pairing, setPairing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState<string>(DEFAULT_DAYS);
  const [daysCustom, setDaysCustom] = useState(false);
  /** Open while the camera is up. The scanned value lands in `agent` directly. */
  const [scanning, setScanning] = useState(false);

  /**
   * Whether this screen is still showing when the grant lands.
   *
   * The grant outlives the screen: it runs in the session, so someone can close the flow while
   * Face ID and the chain do their part, and it still lands.
   */
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);

  /**
   * One read of every answer, used by each step's gate, the review and the grant itself. They
   * previously each decided for themselves and disagreed about the expiry in the dangerous
   * direction — see `readGrantTerms`.
   */
  const read = useMemo(() => readGrantTerms({ agent, amount, days }), [agent, amount, days]);
  const terms = "terms" in read ? read.terms : null;
  const problems = "problems" in read ? read.problems : NO_PROBLEMS;

  const agentReady = agent.length > 0 && problems.agent === null;
  const amountReady = amount.length > 0 && problems.amount === null;
  const windowReady = problems.days === null;

  /** What to call the agent on the later steps: the name just typed, one kept from before, or its address. */
  const who = cleanAgentName(name) || (isAddress(agent) ? nameOf(agent) ?? shortAddress(agent) : agent);

  /**
   * Built from the terms that would actually be granted, never from a parallel set held for
   * display. The sentence directly above the button is the one place that must not lie.
   */
  const summary = useMemo(
    () => (terms === null ? null : grantSummary({ limit: terms.limit, days: terms.days })),
    [terms],
  );

  const canGrant = terms !== null && !wallet.busy && !mandate.busy && mandate.ready === true;

  /** Typed or pasted. The agent's whole link carries its pairing code; a bare address does not. */
  const enterAgent = useCallback((typed: string) => {
    const entry = entryFromText(typed);
    setAgent(entry.agent);
    setPairing(entry.pairing);
  }, []);

  const back = useCallback(() => {
    const previous = ORDER[ORDER.indexOf(step) - 1];
    if (step === "done" || previous === undefined) router.back();
    else setStep(previous);
  }, [step, router]);

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
    const chosenName = cleanAgentName(name);
    mandate.grant(
      mandateTermsFor(terms, pairing, Date.now()),
      // Runs when the grant has landed, not when it was asked for. The name is kept only then, so
      // a cancelled Face ID does not leave a name behind for an agent that was never granted.
      () => {
        if (chosenName.length > 0) rename(terms.agent, chosenName);
        feelSuccess();
        if (open.current) setStep("done");
      },
    );
  }, [terms, name, pairing, mandate, rename]);

  const bar = (action?: { title: string; enabled: boolean; onPress: () => void }) => (
    <WizardTopBar title={TITLES[step]} onBack={back} closes={step === "agent" || step === "done"} {...(action ? { action } : {})} />
  );

  if (step === "agent") {
    return (
      <>
        <ScanModal
          visible={scanning}
          onClose={() => setScanning(false)}
          onScanned={(scanned) => {
            const entry = entryFromScan(scanned);
            setAgent(entry.agent);
            setPairing(entry.pairing);
            setScanning(false);
            feelSuccess();
          }}
        />
        <Screen
          header={bar()}
          footer={<Button tier="solid" title="Next" onPress={() => setStep("amount")} disabled={!agentReady} />}
        >
          <Button icon="qr-code-outline" title="Scan the agent's code" onPress={() => setScanning(true)} />
          <Surface>
            <Field
              label="Agent address"
              value={agent}
              onChangeText={enterAgent}
              placeholder="0x…"
              hint="Scan your agent's code. The link it prints can be pasted here too."
              problem={problems.agent}
              confirmed={agentReady}
              data
            />
            <Field
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Optional, like Maze runner"
              hint="What you call this agent. Kept on this phone only, so the list shows a name instead of an address."
              maxLength={MAX_AGENT_NAME}
            />
          </Surface>
          {agentReady && pairing === null && (
            <Note>An agent using the Arc Mandate connector will not use this allowance. Scan its code instead.</Note>
          )}
        </Screen>
      </>
    );
  }

  if (step === "amount") {
    const balance = wallet.balance;
    const over = terms !== null && exceedsWallet(terms.limit, balance);
    return (
      <Screen fill header={bar({ title: "Continue", enabled: amountReady, onPress: () => setStep("window") })}>
        <AgentChip who={who} onEdit={() => setStep("agent")} />
        <View style={styles.walletLine}>
          <Text style={[styles.walletLabel, { color: c.muted }]}>In your wallet</Text>
          <Text style={[styles.walletValue, { color: c.paper }]}>{balance?.format(2) ?? "—"} USDC</Text>
        </View>
        <Surface style={styles.heroPanel}>
          <AmountHero value={amount} onChangeText={setAmount} unit="USDC" problem={problems.amount} />
          {over && (
            <Text style={[styles.over, { color: c.dim }]}>
              More than your wallet holds now. The agent can only spend what is there when it pays.
            </Text>
          )}
        </Surface>
        <View style={styles.presets}>
          {AMOUNTS.map((preset) => (
            <PresetChip key={preset} label={preset} selected={amount === preset} onPress={() => setAmount(preset)} />
          ))}
        </View>
      </Screen>
    );
  }

  if (step === "window") {
    return (
      <Screen
        header={bar()}
        {...(daysCustom
          ? { footer: <Button tier="solid" title="Next" onPress={() => setStep("review")} disabled={!windowReady} /> }
          : {})}
      >
        <AgentChip who={who} onEdit={() => setStep("agent")} />
        <Surface style={styles.group}>
          {WINDOWS.map((window, index) => (
            <ChoiceListRow
              key={window.days}
              title={window.label}
              detail={windowEndLabel(Number(window.days))}
              selected={!daysCustom && days === window.days}
              // One tap answers the question, so it moves straight on, as Kuira's token list does.
              onPress={() => { setDays(window.days); setDaysCustom(false); setStep("review"); }}
              first={index === 0}
            />
          ))}
          <ChoiceListRow
            title="Custom"
            detail={daysCustom && windowReady ? windowEndLabel(Number(days)) : "Any number of days"}
            selected={daysCustom}
            onPress={() => setDaysCustom(true)}
            first={false}
          />
        </Surface>
        {daysCustom && (
          <Surface>
            <Field
              label="Days"
              value={days}
              onChangeText={setDays}
              placeholder="7"
              keyboardType="decimal-pad"
              problem={problems.days}
            />
          </Surface>
        )}
        <Text style={[styles.hint, { color: c.dim }]}>
          After this the allowance stops working on its own, with nothing to remember.
        </Text>
      </Screen>
    );
  }

  if (step === "review" && terms !== null) {
    return (
      <Screen
        header={bar()}
        footer={
          <Button
            tier="solid"
            title="Grant allowance"
            onPress={grant}
            busy={mandate.pending?.kind === "grant"}
            disabled={!canGrant}
          />
        }
      >
        <View style={styles.reviewHero}>
          {/* The whole ring in the "still allowed" colour: nothing is spent on a new allowance. */}
          <ArcRing spent={0} size={tokens.size.ring.review} label="" />
          <Text style={[styles.reviewAmount, { color: c.paper }]}>
            {terms.limit.format(2)}
            <Text style={[styles.reviewUnit, { color: c.muted }]}>  USDC</Text>
          </Text>
          <Text style={[styles.reviewFor, { color: c.muted }]}>for {who}</Text>
        </View>
        <Surface style={styles.group}>
          <DetailRow label="Agent" value={who} first />
          {who !== shortAddress(terms.agent) && <DetailRow label="Address" value={shortAddress(terms.agent)} data />}
          <DetailRow label="Limit" value={`${terms.limit.format(2)} USDC`} />
          <DetailRow label="Ends" value={windowEndLabel(terms.days).replace(/^Ends /, "")} />
        </Surface>
        {summary !== null && <Note>{summary}</Note>}
        {exceedsWallet(terms.limit, wallet.balance) && (
          <Note>{`That is more than the ${wallet.balance?.format(2) ?? ""} USDC in your wallet now. The agent can only spend what the wallet holds when it pays.`}</Note>
        )}
        {mandate.error !== null && <Note tone="warn" lines={ERROR_LINES}>{mandate.error}</Note>}
        {mandate.ready === false && <Note tone="warn">Allowances are not deployed on Arc testnet yet.</Note>}
      </Screen>
    );
  }

  if (step === "done" && terms !== null) {
    return (
      <Screen centered header={bar()} footer={<Button tier="solid" title="Done" onPress={() => router.back()} />}>
        <View style={styles.done}>
          <ArcRing spent={0} size={tokens.size.ring.welcome} label="" />
          <Text style={[styles.doneTitle, { color: c.paper }]}>Allowance granted</Text>
          <Text style={[styles.doneBody, { color: c.muted }]}>
            {grantedSentence({ who, limit: terms.limit, days: terms.days })}
          </Text>
          {/* The next step is on the other device, so the phone says so rather than going quiet. */}
          <Text style={[styles.doneNext, { color: c.paper }]}>
            Next, on your computer: tell your agent what to do. It can start now.
          </Text>
        </View>
      </Screen>
    );
  }

  // Reached only if the answers stopped reading between steps, which the gates prevent. Back to the
  // start rather than a blank screen.
  return (
    <Screen header={bar()}>
      <Note>Something in the answers no longer reads. Start again from the agent.</Note>
      <Button title="Start again" onPress={() => setStep("agent")} />
    </Screen>
  );
}

/** The presets, as the strings the amount field edits, so a preset and a typed figure are one state. */
const AMOUNTS: readonly string[] = ["5", "20", "100"];
const WINDOWS: readonly { readonly label: string; readonly days: string }[] = [
  { label: "1 day", days: "1" },
  { label: "7 days", days: "7" },
  { label: "30 days", days: "30" },
];
const DEFAULT_DAYS = "7";

/** Enough of a chain error to recognise it; the harness log has the whole thing. */
const ERROR_LINES = 3;

/** Nothing to complain about yet, and the same shape the reader returns. */
const NO_PROBLEMS = { agent: null, amount: null, days: null } as const;

const styles = StyleSheet.create({
  group: { padding: 0, gap: 0, overflow: "hidden" },
  walletLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  walletLabel: tokens.type.subheadline,
  walletValue: { ...tokens.type.subheadline, fontVariant: [...tokens.font.tabular] },
  /** Takes every point the other parts leave, so the figure is the screen. */
  heroPanel: { flex: 1, justifyContent: "center", gap: tokens.space.base },
  over: { ...tokens.type.footnote, textAlign: "center" },
  presets: { flexDirection: "row", gap: tokens.space.sm },
  hint: tokens.type.footnote,
  reviewHero: { alignItems: "center", gap: tokens.space.xs, paddingVertical: tokens.space.base },
  reviewAmount: { ...tokens.type.hero, marginTop: tokens.space.md, fontVariant: [...tokens.font.tabular] },
  reviewUnit: { ...tokens.type.headline, fontWeight: "400", letterSpacing: 0 },
  reviewFor: tokens.type.subheadline,
  done: { alignItems: "center", gap: tokens.space.base },
  doneTitle: { ...tokens.type.title, textAlign: "center" },
  doneBody: { ...tokens.type.body, textAlign: "center" },
  doneNext: { ...tokens.type.headline, textAlign: "center" },
});
