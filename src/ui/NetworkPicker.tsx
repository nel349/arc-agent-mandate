import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NetworkProfile } from "@kuiralabs/mandate-core";
import { accentOf } from "./network-look.ts";
import { NetworkLogo } from "./NetworkLogo.tsx";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/** What kind of money a network holds, said under its name everywhere it is named. */
export const moneyOf = (network: NetworkProfile): string => (network.live ? "Real money" : "Test money");

/** The networks in two groups, real money first: a person should never pick test money by accident or real money without seeing it. */
export function groupNetworks(networks: readonly NetworkProfile[]): { readonly mainnets: readonly NetworkProfile[]; readonly testnets: readonly NetworkProfile[] } {
  return { mainnets: networks.filter((n) => n.live), testnets: networks.filter((n) => !n.live) };
}

/**
 * Which network the wallet is on, and the way to another: a pill that opens a sheet.
 *
 * It was a row of chips, one per network, named without "testnet" because every one of them was a
 * testnet. With a mainnet beside them the difference that matters most, real money or test money,
 * was nowhere on screen, and a fourth network would not have fitted the row. Wallets that hold
 * many networks put the current one in a pill and the choice in a sheet, mainnets apart from
 * testnets; this does the same. Real money and test money live in separate wallets, each with its
 * own passkey, because Circle will not let one passkey hold both, and a testnet row says so.
 */
export function NetworkPicker({
  networks, selected, onSelect,
}: {
  readonly networks: readonly NetworkProfile[];
  readonly selected: NetworkProfile;
  readonly onSelect: (network: NetworkProfile) => void;
}) {
  const c = useTheme().color;
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { mainnets, testnets } = groupNetworks(networks);
  const choose = (network: NetworkProfile) => {
    setOpen(false);
    if (network.chainId !== selected.chainId) onSelect(network);
  };
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Network: ${selected.name}, ${moneyOf(selected)}. Change network`}
        style={({ pressed }) => [styles.pill, { backgroundColor: c.glass, borderColor: c.hairline }, pressed && styles.pressed]}
      >
        <NetworkLogo network={selected} size={tokens.size.networkLogo.pill} />
        <Text style={[styles.pillName, { color: c.paper }]} numberOfLines={1}>{selected.name}</Text>
        <Text style={[styles.pillMoney, { color: selected.live ? accentOf(selected) : c.dim }]} numberOfLines={1}>{moneyOf(selected)}</Text>
        <Ionicons name="chevron-down" size={tokens.size.chevron} color={c.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        {/* The dimmed screen fills the window behind the sheet, so on a wide window the sides beside it dim too. */}
        <View style={styles.backdrop}>
          <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={() => setOpen(false)} accessibilityLabel="Close" />
          <View style={[styles.sheet, { backgroundColor: c.groundMid, borderColor: c.hairline, paddingBottom: insets.bottom + tokens.space.lg }]}>
            <View style={[styles.grabber, { backgroundColor: c.hairline }]} />
            <Text style={[styles.title, { color: c.paper }]} accessibilityRole="header">Network</Text>
            <Group label="Mainnet" networks={mainnets} selected={selected} onChoose={choose} />
            <Group label="Testnets" networks={testnets} selected={selected} onChoose={choose} />
            <Text style={[styles.note, { color: c.dim }]}>
              Real money and test money are separate wallets, each opened with its own passkey.
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Group({
  label, networks, selected, onChoose,
}: {
  readonly label: string;
  readonly networks: readonly NetworkProfile[];
  readonly selected: NetworkProfile;
  readonly onChoose: (network: NetworkProfile) => void;
}) {
  const c = useTheme().color;
  if (networks.length === 0) return null;
  return (
    <View style={styles.group}>
      <Text style={[styles.section, { color: c.dim }]}>{label}</Text>
      <View style={[styles.rows, { backgroundColor: c.glass, borderColor: c.hairline }]}>
        {networks.map((network, i) => {
          const on = network.chainId === selected.chainId;
          return (
            <Pressable
              key={network.chainId}
              onPress={() => onChoose(network)}
              accessibilityRole="radio"
              aria-checked={on}
              accessibilityLabel={`${network.name}, ${moneyOf(network)}`}
              style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: tokens.border.hairline, borderTopColor: c.hairline }, pressed && styles.pressed]}
            >
              <NetworkLogo network={network} size={tokens.size.networkLogo.row} />
              <View style={styles.rowText}>
                <Text style={[styles.rowName, { color: c.paper }]}>{network.name}</Text>
                <Text style={[styles.rowMoney, { color: c.muted }]}>{moneyOf(network)}</Text>
              </View>
              {on && <Ionicons name="checkmark" size={tokens.size.buttonIcon} color={c.paper} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: tokens.space.xs,
    minHeight: tokens.size.tapTarget, paddingHorizontal: tokens.space.base,
    borderRadius: tokens.radius.pill, borderWidth: tokens.border.hairline,
  },
  pillName: { ...tokens.type.headline },
  pillMoney: { ...tokens.type.footnote },
  pressed: { opacity: tokens.opacity.pressed },
  backdrop: { flex: 1, justifyContent: "flex-end" },
  scrim: { backgroundColor: `rgba(0, 0, 0, ${tokens.opacity.scrim})` },
  // As wide as the wallet's column and no wider: in a laptop's window a sheet the width of the window is a banner.
  sheet: {
    width: "100%", maxWidth: tokens.size.column, alignSelf: "center",
    paddingHorizontal: tokens.space.lg, paddingTop: tokens.space.sm, gap: tokens.space.base,
    borderTopLeftRadius: tokens.radius.lg, borderTopRightRadius: tokens.radius.lg, borderWidth: tokens.border.hairline,
  },
  grabber: { alignSelf: "center", ...tokens.size.grabber, borderRadius: tokens.radius.pill },
  title: { ...tokens.type.title },
  group: { gap: tokens.space.xs },
  section: { ...tokens.type.section },
  rows: { borderRadius: tokens.radius.md, borderWidth: tokens.border.hairline, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.md, minHeight: tokens.size.tapTarget + tokens.space.base, paddingHorizontal: tokens.space.base },
  rowText: { flex: 1, gap: tokens.space.hair },
  rowName: { ...tokens.type.headline },
  rowMoney: { ...tokens.type.footnote },
  note: { ...tokens.type.footnote },
});
