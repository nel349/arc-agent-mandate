import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Address } from "viem";
import type { NetworkProfile } from "@kuiralabs/mandate-core";
import type { Amount } from "../arc/amount.ts";
import { figure, unitOf } from "./coin.ts";
import { CornerMarks } from "./CornerMarks.tsx";
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
 * An allowance as a card the wallet issues to an agent, printed like a key listing.
 *
 * Graphite, inside registration marks, with the one colour in the app: the network's, down its edge
 * and beside its name. The figure is the only large thing on it. Below, label and value rows the way
 * a key is listed, and the agent's address as a fingerprint, which a person can check group by group
 * against what their laptop shows. Everything about the allowance is said here once, so a screen that
 * shows a card repeats none of it.
 */
export function AllowanceCard({ face }: { readonly face: AllowanceFace }) {
  const c = useTheme().color;
  const accent = accentOf(face.network);

  return (
    <View
      style={[styles.card, { backgroundColor: c.groundLow, borderColor: c.hairline }]}
      accessible
      accessibilityLabel={face.spoken}
    >
      <View style={[styles.edge, { backgroundColor: accent }]} />
      <CornerMarks color={c.dim} length={MARK_LENGTH} stroke={MARK_STROKE} />

      <View style={styles.head}>
        <Text style={[styles.kind, { color: c.dim }]}>ALLOWANCE</Text>
        <View style={styles.network}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <Text style={[styles.kind, { color: c.paper }]}>{shortNameOf(face.network).toUpperCase()}</Text>
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
        {face.name !== null && <Row label="NAME" color={c}><Text style={[styles.value, { color: c.paper }]} numberOfLines={1}>{face.name}</Text></Row>}
        <Row label="AGENT" color={c}>
          <View>
            {fingerprintLines(face.agent).map((line) => (
              <Text key={line} style={[styles.value, { color: c.paper }]}>{line}</Text>
            ))}
          </View>
        </Row>
        {face.askedBy !== null && <Row label="ASKED" color={c}><Text style={[styles.value, { color: c.paper }]} numberOfLines={1}>{face.askedBy}</Text></Row>}
        {face.payees.length > 0 && (
          <Row label="PAYS" color={c}>
            <Text style={[styles.value, { color: c.paper }]} numberOfLines={1}>
              {face.payees.length === 1 ? shortFingerprint(face.payees[0] ?? "") : `${face.payees.length} ADDRESSES ONLY`}
            </Text>
          </Row>
        )}
        {face.calls.map((call) => (
          <Row key={call.contract} label="CALLS" color={c}>
            <View>
              <Text style={[styles.value, { color: c.paper }]}>{call.functions.map(nameOf).join(", ")}</Text>
              <Text style={[styles.value, { color: c.muted }]}>on {shortFingerprint(call.contract)}</Text>
            </View>
          </Row>
        ))}
        <Row label="ENDS" color={c}><Text style={[styles.value, { color: c.paper }]}>{(face.ends ?? "never").toUpperCase()}</Text></Row>
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

const MARK_LENGTH = 12;
const MARK_STROKE = 1.5;
/** The network's stripe down the card's leading edge. */
const EDGE_WIDTH = 3;
/** Wide enough for the longest label, so every value starts on the same line. */
const LABEL_COLUMN = 64;

const mono = { fontFamily: tokens.font.mono } as const;
/** Small capitals spaced out, as a label on a printed card is. */
const TRACKED = 2;

const styles = StyleSheet.create({
  card: {
    borderWidth: tokens.border.hairline,
    borderRadius: tokens.radius.sm,
    paddingVertical: tokens.space.lg,
    paddingLeft: tokens.space.lg + EDGE_WIDTH,
    paddingRight: tokens.space.lg,
    gap: tokens.space.base,
    overflow: "hidden",
  },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: EDGE_WIDTH },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  network: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  dot: { width: tokens.space.xs, height: tokens.space.xs },
  kind: { ...tokens.type.caption, ...mono, letterSpacing: TRACKED },
  figureRow: { flexDirection: "row", alignItems: "baseline", gap: tokens.space.sm },
  figure: { ...tokens.type.hero, ...mono, flexShrink: 1, fontVariant: [...tokens.font.tabular] },
  unit: { ...tokens.type.subheadline, ...mono },
  rule: { height: tokens.border.hairline },
  rows: { gap: tokens.space.sm },
  row: { flexDirection: "row", alignItems: "flex-start" },
  label: { ...tokens.type.data, ...tokens.type.caption, ...mono, width: LABEL_COLUMN, lineHeight: tokens.type.data.lineHeight, letterSpacing: TRACKED },
  cell: { flex: 1 },
  value: tokens.type.data,
});
