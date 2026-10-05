import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isAddress } from "viem";
import { NO_REQUEST, type AgentRequest } from "@kuiralabs/mandate-core";
import { useLeave } from "../src/ui/useLeave.ts";
import { AgentChip } from "../src/ui/AgentChip.tsx";
import { AllowanceCard } from "../src/ui/AllowanceCard.tsx";
import { AmountHero } from "../src/ui/AmountHero.tsx";
import { Button } from "../src/ui/Button.tsx";
import { ChoiceListRow } from "../src/ui/ChoiceListRow.tsx";
import { CornerMarks } from "../src/ui/CornerMarks.tsx";
import { Field } from "../src/ui/Field.tsx";
import { ERROR_LINES, Note } from "../src/ui/Note.tsx";
import { PresetChip } from "../src/ui/PresetChip.tsx";
import { ScanModal } from "../src/ui/ScanModal.tsx";
import { Screen } from "../src/ui/Screen.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { WizardTopBar } from "../src/ui/WizardTopBar.tsx";
import { cleanAgentName, MAX_AGENT_NAME } from "../src/ui/agent-names.ts";
import { useAgentNames } from "../src/ui/agent-names-context.tsx";
import { inCoin, unitOf } from "../src/ui/coin.ts";
import { ALREADY_GRANTED } from "../src/ui/failure.ts";
import { alreadyGranted, entryFromScan, entryFromText, mandateTermsFor, networkOfEntry, type AgentEntry } from "../src/ui/grant-entry.ts";
import { amountPresets, CARD_TERMS, exceedsWallet, faceOf, grantedSentence, windowEndLabel } from "../src/ui/grant-format.ts";
import { stepAfter, type GrantStep } from "../src/ui/grant-steps.ts";
import { readGrantTerms } from "../src/ui/grant-terms.ts";
import { feelSuccess } from "../src/ui/haptics.ts";
import { shortAddress } from "../src/ui/mandate-format.ts";
import { useSession } from "../src/ui/session-context.tsx";
import { useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

/**
 * Giving an agent an allowance: the wallet issues it a card.
 *
 * Scanning the agent's code is how nearly everyone arrives, so it is the screen's one big thing, and
 * typing an address is a quiet way round it. The code can carry what the app the agent works for
 * asks for, and then the next thing shown is the card itself, filled in, with every line still the
 * person's to change. Whatever the code left out is asked one question per screen. The wallet names
 * no app: anything shown about one came from the code.
 *
 * The card is the review. Everything about the allowance is printed on it once, the network sits on
 * the frame above, the one sentence under it says what an allowance is, and the button says the
 * amount it grants.
 */
const TITLES: Readonly<Record<GrantStep, string>> = {
  agent: "New allowance",
  amount: "Set the limit",
  window: "Choose how long",
  card: "Review",
  done: "",
};

export default function GrantScreen() {
  const { wallet, mandate } = useSession();
  const { nameGranted } = useAgentNames();
  const leave = useLeave();
  const c = useTheme().color;
  const network = wallet.network;

  /** Every step visited, so Back retraces exactly the questions this agent was asked. */
  const [trail, setTrail] = useState<readonly GrantStep[]>(["agent"]);
  const step = trail[trail.length - 1] ?? "agent";
  const [agent, setAgent] = useState("");
  /** The one-time code the agent's QR carried, written into the grant. Null when the address was typed. */
  const [pairing, setPairing] = useState<string | null>(null);
  /** The chain the agent's code named, which decides where it is granted. Null when the address was typed. */
  const [chainId, setChainId] = useState<number | null>(null);
  /** What the app the agent works for asked for, from its code: a suggestion, every part changeable. */
  const [request, setRequest] = useState<AgentRequest>(NO_REQUEST);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState<string>("");
  const [daysCustom, setDaysCustom] = useState(false);
  const [scanning, setScanning] = useState(false);
  /** The address field, shown only for someone who would rather type or paste than scan. */
  const [typing, setTyping] = useState(false);
  /** A change asked for from the card returns to it, rather than walking every question after. */
  const [changing, setChanging] = useState(false);
  /** A scan moves on by itself once the agent reads as ready; typing waits for Next. */
  const [advanceWhenReady, setAdvanceWhenReady] = useState(false);

  /** Whether this screen is still showing when the grant lands; it runs in the session and can outlive it. */
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);

  const read = useMemo(() => readGrantTerms({ agent, amount, days }), [agent, amount, days]);
  const terms = "terms" in read ? read.terms : null;
  const problems = "problems" in read ? read.problems : NO_PROBLEMS;

  /** Where this agent is granted: the network its code named, or the wallet's own for a typed address. */
  const placed = networkOfEntry({ chainId }, network);
  const onItsNetwork = "network" in placed && placed.network.chainId === network.chainId;
  const already = alreadyGranted(agent, mandate.mandates);
  const agentReady = agent.length > 0 && problems.agent === null && !already && onItsNetwork && !wallet.busy;
  const amountReady = amount.length > 0 && problems.amount === null;
  const windowReady = days.length > 0 && problems.days === null;
  const answered = { limit: amountReady, days: windowReady, changing };

  /** What to call the agent: the name typed, or its address. */
  const who = cleanAgentName(name) || (isAddress(agent) ? shortAddress(agent) : agent);
  const canGrant = terms !== null && !wallet.busy && !mandate.busy && mandate.ready === true && onItsNetwork;

  const go = useCallback((next: GrantStep) => setTrail((was) => [...was, next]), []);
  const back = useCallback(() => {
    if (trail.length <= 1 || step === "done") leave();
    else setTrail((was) => was.slice(0, -1));
  }, [trail.length, step, leave]);

  /**
   * An agent entered, by scan or by keyboard. Its code names the network it spends on, and the wallet
   * moves there for the grant. What its app asked for fills in the answers, each still changeable.
   */
  const { switchNetwork } = wallet;
  const take = useCallback((entry: AgentEntry) => {
    setAgent(entry.agent);
    setPairing(entry.pairing);
    setChainId(entry.chainId);
    setRequest(entry.request);
    if (entry.request.limit !== null) setAmount(entry.request.limit);
    if (entry.request.days !== null) {
      setDays(String(entry.request.days));
      setDaysCustom(!WINDOWS.some((window) => window.days === String(entry.request.days)));
    }
    const where = networkOfEntry(entry, network);
    if ("network" in where && where.network.chainId !== network.chainId) switchNetwork(where.network);
  }, [network, switchNetwork]);

  const enterAgent = useCallback((typed: string) => take(entryFromText(typed)), [take]);

  // A scanned agent moves on as soon as it reads as ready, which may wait on the wallet moving network.
  useEffect(() => {
    if (!advanceWhenReady || step !== "agent" || !agentReady) return;
    setAdvanceWhenReady(false);
    go(stepAfter("agent", answered));
  }, [advanceWhenReady, step, agentReady, answered, go]);

  /** From the card, one line changed and straight back. */
  const change = useCallback((target: "amount" | "window") => { setChanging(true); go(target); }, [go]);
  const next = useCallback((from: "amount" | "window") => {
    if (changing) {
      setChanging(false);
      setTrail((was) => [...was.slice(0, was.lastIndexOf("card") + 1)]);
      return;
    }
    go(stepAfter(from, answered));
  }, [changing, go, answered]);

  const grant = useCallback(() => {
    if (terms === null) return;
    const chosenName = cleanAgentName(name);
    mandate.grant(
      mandateTermsFor(terms, pairing, Date.now(), request.payees),
      // Runs when the grant has landed. The name is kept only then, for this allowance alone.
      (granted) => {
        nameGranted(terms.agent, granted, chosenName);
        feelSuccess();
        if (open.current) go("done");
      },
    );
  }, [terms, name, pairing, request.payees, mandate, nameGranted, go]);

  const bar = (action?: { title: string; enabled: boolean; onPress: () => void }) => (
    <WizardTopBar
      title={TITLES[step]}
      // the network on the frame, until a card is showing, which prints it itself
      {...(step === "card" || step === "done" ? {} : { detail: network.name })}
      onBack={back}
      closes={trail.length <= 1 || step === "done"}
      {...(action ? { action } : {})}
    />
  );

  const face = terms === null
    ? null
    : faceOf({ terms, name: cleanAgentName(name) || null, askedBy: request.app, payees: request.payees, network });

  if (step === "agent") {
    return (
      <>
        <ScanModal
          visible={scanning}
          onClose={() => setScanning(false)}
          onScanned={(scanned) => {
            take(entryFromScan(scanned));
            setScanning(false);
            setAdvanceWhenReady(true);
            feelSuccess();
          }}
        />
        <Screen
          header={bar()}
          {...(typing ? { footer: <Button tier="solid" title="Next" onPress={() => go(stepAfter("agent", answered))} disabled={!agentReady} /> } : {})}
        >
          <Pressable
            onPress={() => setScanning(true)}
            accessibilityRole="button"
            accessibilityLabel="Scan your agent's code"
            style={({ pressed }) => [styles.scan, pressed && styles.pressed]}
          >
            <CornerMarks color={c.muted} length={SCAN_MARK} stroke={tokens.border.hairline * 2} />
            <Ionicons name="qr-code-outline" size={SCAN_GLYPH} color={c.paper} />
            <Text style={[styles.scanTitle, { color: c.paper }]}>Scan your agent&apos;s code</Text>
            <Text style={[styles.scanBody, { color: c.dim }]}>It shows one when you connect it on your computer.</Text>
          </Pressable>

          {typing ? (
            <Surface>
              <Field
                label="Agent address"
                value={agent}
                onChangeText={enterAgent}
                placeholder="0x…"
                hint="The link your agent prints can be pasted here too."
                problem={problems.agent}
                confirmed={agentReady}
                data
              />
            </Surface>
          ) : (
            <Pressable onPress={() => setTyping(true)} accessibilityRole="button" style={styles.quiet} hitSlop={tokens.space.sm}>
              <Text style={[styles.quietText, { color: c.muted }]}>Paste or type its address instead</Text>
            </Pressable>
          )}

          {"problem" in placed && <Note tone="warn">{placed.problem}</Note>}
          {wallet.error !== null && <Note tone="warn" lines={ERROR_LINES}>{wallet.error}</Note>}
          {already && <Note>{ALREADY_GRANTED}</Note>}
          {typing && agentReady && pairing === null && (
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
      <Screen fill header={bar({ title: changing ? "Done" : "Continue", enabled: amountReady, onPress: () => next("amount") })}>
        <AgentChip who={who} onEdit={() => setTrail(["agent"])} />
        <View style={styles.amount}>
          <AmountHero value={amount} onChangeText={setAmount} unit={unitOf(network)} problem={problems.amount} />
          <Text style={[styles.balance, { color: over ? c.warn : c.dim }]}>
            {balance === null ? `${unitOf(network)} in your wallet: reading` : `${inCoin(balance, network)} in your wallet`}
          </Text>
        </View>
        <View style={styles.presets}>
          {amountPresets(network).map((preset) => (
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
        {...(daysCustom ? { footer: <Button tier="solid" title={changing ? "Done" : "Next"} onPress={() => next("window")} disabled={!windowReady} /> } : {})}
      >
        <AgentChip who={who} onEdit={() => setTrail(["agent"])} />
        <Surface style={styles.group}>
          {WINDOWS.map((window, index) => (
            <ChoiceListRow
              key={window.days}
              title={window.label}
              detail={windowEndLabel(Number(window.days))}
              selected={!daysCustom && days === window.days}
              // One tap answers the question, so it moves straight on.
              onPress={() => { setDays(window.days); setDaysCustom(false); next("window"); }}
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
            <Field label="Days" value={days} onChangeText={setDays} placeholder="7" keyboardType="decimal-pad" problem={problems.days} />
          </Surface>
        )}
        <Text style={[styles.hint, { color: c.dim }]}>After this the allowance stops working on its own.</Text>
      </Screen>
    );
  }

  if (step === "card" && terms !== null && face !== null) {
    return (
      <Screen
        header={bar()}
        footer={
          <Button
            tier="solid"
            title={`Grant ${inCoin(terms.limit, network)}`}
            onPress={grant}
            busy={mandate.pending?.kind === "grant"}
            disabled={!canGrant}
          />
        }
      >
        <AllowanceCard face={face} />
        <View style={styles.changes}>
          <Pressable onPress={() => change("amount")} accessibilityRole="button" accessibilityLabel="Change limit" hitSlop={tokens.space.sm}>
            <Text style={[styles.change, { color: c.muted }]}>CHANGE LIMIT</Text>
          </Pressable>
          <Text style={[styles.change, { color: c.dim }]}>/</Text>
          <Pressable onPress={() => change("window")} accessibilityRole="button" accessibilityLabel="Change length" hitSlop={tokens.space.sm}>
            <Text style={[styles.change, { color: c.muted }]}>CHANGE LENGTH</Text>
          </Pressable>
        </View>
        <Text style={[styles.terms, { color: c.muted }]}>{CARD_TERMS}</Text>
        <Surface>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="What you call this agent"
            hint="Kept on this phone only, so your list shows a name instead of an address."
            maxLength={MAX_AGENT_NAME}
          />
        </Surface>
        {exceedsWallet(terms.limit, wallet.balance) && wallet.balance !== null && (
          <Note>{`Your wallet holds ${inCoin(wallet.balance, network)} now. The agent can only spend what is there when it pays.`}</Note>
        )}
        {already && <Note>{ALREADY_GRANTED}</Note>}
        {mandate.error !== null && <Note tone="warn" lines={ERROR_LINES}>{mandate.error}</Note>}
        {mandate.ready === false && <Note tone="warn">{`Allowances are not deployed on ${network.name} yet.`}</Note>}
      </Screen>
    );
  }

  if (step === "done" && terms !== null && face !== null) {
    return (
      <Screen header={bar()} footer={<Button tier="solid" title="Done" onPress={leave} />}>
        <AllowanceCard face={{ ...face, spoken: grantedSentence({ who, limit: terms.limit, days: terms.days, network }) }} />
        <View style={styles.done}>
          <Text style={[styles.doneTitle, { color: c.paper }]}>Allowance granted</Text>
          <Text style={[styles.doneBody, { color: c.muted }]}>Nothing has left your wallet yet.</Text>
          {/* The next step is on the other device, so the phone says so rather than going quiet. */}
          <Text style={[styles.doneNext, { color: c.paper }]}>Next, on your computer: tell your agent what to do.</Text>
        </View>
      </Screen>
    );
  }

  // Reached only if the answers stopped reading between steps, which the gates prevent.
  return (
    <Screen header={bar()}>
      <Note>Something in the answers no longer reads. Start again from the agent.</Note>
      <Button title="Start again" onPress={() => setTrail(["agent"])} />
    </Screen>
  );
}

const WINDOWS: readonly { readonly label: string; readonly days: string }[] = [
  { label: "1 day", days: "1" },
  { label: "7 days", days: "7" },
  { label: "30 days", days: "30" },
];

/** Nothing to complain about yet, and the same shape the reader returns. */
const NO_PROBLEMS = { agent: null, amount: null, days: null } as const;

/** The scan glyph, large enough to read as the screen's one thing to do. */
const SCAN_GLYPH = 56;
/** The registration marks round the scan panel: the scanner's own frame, smaller. */
const SCAN_MARK = 22;
/** Small capitals spaced out, as on the card. */
const TRACKED = 2;

const styles = StyleSheet.create({
  scan: {
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xl * 2,
    paddingHorizontal: tokens.space.lg,
  },
  scanTitle: tokens.type.title,
  scanBody: { ...tokens.type.subheadline, textAlign: "center" },
  pressed: { opacity: tokens.opacity.pressed },
  quiet: { alignSelf: "center", paddingVertical: tokens.space.sm },
  quietText: { ...tokens.type.subheadline, textDecorationLine: "underline" },
  group: { padding: 0, gap: 0, overflow: "hidden" },
  /** Takes the space the parts above and below leave, so the figure is the screen, with no box drawn round it. */
  amount: { flex: 1, justifyContent: "center", gap: tokens.space.base },
  balance: { ...tokens.type.footnote, textAlign: "center", fontVariant: [...tokens.font.tabular] },
  presets: { flexDirection: "row", gap: tokens.space.sm },
  hint: tokens.type.footnote,
  changes: { flexDirection: "row", gap: tokens.space.md, justifyContent: "center" },
  change: { ...tokens.type.caption, fontFamily: tokens.font.mono, letterSpacing: TRACKED },
  terms: { ...tokens.type.subheadline, textAlign: "center" },
  done: { alignItems: "center", gap: tokens.space.base, paddingTop: tokens.space.base },
  doneTitle: { ...tokens.type.title, textAlign: "center" },
  doneBody: { ...tokens.type.body, textAlign: "center" },
  doneNext: { ...tokens.type.headline, textAlign: "center" },
});
