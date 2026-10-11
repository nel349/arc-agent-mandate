import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Address } from "viem";
import type { NetworkProfile } from "@kuiralabs/mandate-core";
import type { Amount } from "../arc/amount.ts";
import { figure, unitOf } from "./coin.ts";
import { fingerprintLines, shortFingerprint } from "./fingerprint.ts";
import { shortNameOf } from "./network-choice.ts";
import { accentOf } from "./network-look.ts";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/** Everything printed on a card, from whoever draws it. The card knows no app: it prints what it is given. */
export interface AllowanceFace {
  readonly network: NetworkProfile;
  readonly limit: Amount;
  readonly agent: Address;
  /** what the person calls the agent, or null when they have not named it */
  readonly name: string | null;
  /** "11 OCT 2026", or null for an allowance with no end */
  readonly ends: string | null;
  /** who asked for it, as the agent's code named its app; null when nobody did */
  readonly askedBy: string | null;
  /** the only addresses it pays, when it names any */
  readonly payees: readonly Address[];
  /** the contract functions it may call, when its app's code named any */
  readonly calls: readonly { readonly contract: Address; readonly functions: readonly string[] }[];
  /** the whole card as one sentence, for a screen reader */
  readonly spoken: string;
}

/**
 * An allowance as a card the wallet issues to an agent.
 *
 * A soft card with one large thing on it, the figure. The network is a small tag in its own colour,
 * the only place that colour appears. Below, a label and a value to a row, and the agent's address
 * as a fingerprint, which a person can check group by group against what their laptop shows.
 * Everything about the allowance is said here once, so a screen that shows a card repeats none of it.
 *
 * It was printed like a key listing: black, in mono capitals, inside registration marks, with the
 * network down its edge. That belonged to a look built on ink and squared corners.
 */
export function AllowanceCard({ face }: { readonly face: AllowanceFace }) {
  const c = useTheme().color;
  const accent = accentOf(face.network);

  return (
    <View
      style={[styles.card, { backgroundColor: c.glass, borderColor: c.hairline, borderTopColor: c.specular }]}
      accessible
      accessibilityLabel={face.spoken}
    >
      <View style={styles.head}>
        <Text style={[styles.kind, { color: c.dim }]}>Allowance</Text>
        <View style={[styles.network, { borderColor: c.hairline }]}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <Text style={[styles.kind, { color: c.paper }]}>{shortNameOf(face.network)}</Text>
        </View>
      </View>

      <View style={styles.figureRow}>
        <Text style={[styles.figure, { color: c.paper }]} numberOfLines={1} adjustsFontSizeToFit>
          {figure(face.limit, face.network)}
        </Text>
        <Text style={[styles.unit, { color: c.muted }]}>{unitOf(face.network)}</Text>
      </View>

      <View style={[styles.rule, { backgroundColor: c.hairline }]} />

      <View style={styles.rows}>
        {face.name !== null && <Row label="Name" color={c}><Text style={[styles.words, { color: c.paper }]} numberOfLines={1}>{face.name}</Text></Row>}
        <Row label="Agent" color={c}>
          <View>
            {fingerprintLines(face.agent).map((line) => (
              <Text key={line} style={[styles.value, { color: c.paper }]}>{line}</Text>
            ))}
          </View>
        </Row>
        {face.askedBy !== null && <Row label="Asked by" color={c}><Text style={[styles.words, { color: c.paper }]} numberOfLines={1}>{face.askedBy}</Text></Row>}
        {face.payees.length > 0 && (
          <Row label="Pays" color={c}>
            {face.payees.length === 1
              ? <Text style={[styles.value, { color: c.paper }]} numberOfLines={1}>{shortFingerprint(face.payees[0] ?? "")}</Text>
              : <Text style={[styles.words, { color: c.paper }]} numberOfLines={1}>{`${face.payees.length} addresses only`}</Text>}
          </Row>
        )}
        {face.calls.map((call) => (
          <Row key={call.contract} label="Calls" color={c}>
            <View>
              <Text style={[styles.words, { color: c.paper }]}>{call.functions.map(nameOf).join(", ")}</Text>
              <Text style={[styles.value, { color: c.muted }]}>on {shortFingerprint(call.contract)}</Text>
            </View>
          </Row>
        ))}
        <Row label="Ends" color={c}><Text style={[styles.words, { color: c.paper }]}>{face.ends ?? "Never"}</Text></Row>
      </View>
    </View>
  );
}

/** One line of the listing: a fixed column of label, then its value. */
function Row({ label, color, children }: { readonly label: string; readonly color: { readonly dim: string }; readonly children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: color.dim }]}>{label}</Text>
      <View style={styles.cell}>{children}</View>
    </View>
  );
}

/** A function as a person reads it: its name, without the types the chain needs. */
const nameOf = (signature: string): string => signature.slice(0, signature.indexOf("(")) || signature;

/** The network's dot in its tag. */
const DOT = 6;
/** Wide enough for the longest label, so every value starts on the same line. */
const LABEL_COLUMN = 76;

const styles = StyleSheet.create({
  card: {
    borderWidth: tokens.border.hairline,
    borderRadius: tokens.radius.lg,
    padding: tokens.space.lg,
    gap: tokens.space.base,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  network: {
    flexDirection: "row", alignItems: "center", gap: tokens.space.xs,
    borderWidth: tokens.border.hairline, borderRadius: tokens.radius.pill,
    paddingVertical: tokens.space.tiny, paddingHorizontal: tokens.space.sm,
  },
  dot: { width: DOT, height: DOT, borderRadius: tokens.radius.pill },
  kind: { ...tokens.type.caption, fontWeight: "600" },
  figureRow: { flexDirection: "row", alignItems: "baseline", gap: tokens.space.sm },
  figure: { ...tokens.type.hero, flexShrink: 1, fontVariant: [...tokens.font.tabular] },
  unit: { ...tokens.type.headline, fontWeight: "400" },
  rule: { height: tokens.border.hairline },
  rows: { gap: tokens.space.sm },
  row: { flexDirection: "row", alignItems: "flex-start" },
  // The label takes the value's line height, so a label beside a two-line fingerprint sits on its first line.
  label: { ...tokens.type.footnote, width: LABEL_COLUMN, lineHeight: tokens.type.subheadline.lineHeight },
  cell: { flex: 1 },
  /** An address, compared group by group. */
  value: { ...tokens.type.data, lineHeight: tokens.type.subheadline.lineHeight },
  /** Anything read as a word. */
  words: tokens.type.subheadline,
});
