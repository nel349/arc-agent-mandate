import { StyleSheet, View } from "react-native";
import type { NetworkProfile } from "@kuiralabs/mandate-core";
import { shortNameOf } from "./network-choice.ts";
import { PresetChip } from "./PresetChip.tsx";
import { tokens } from "./tokens.ts";

/**
 * Which network the wallet is shown on, one chip per network.
 *
 * The same passkey is the same wallet on every network, so this changes what is on screen, not whose
 * money it is. Named by the network alone: "testnet" is on every one of them and tells nobody apart.
 */
export function NetworkSwitch({
  networks, selected, onSelect,
}: {
  readonly networks: readonly NetworkProfile[];
  readonly selected: NetworkProfile;
  readonly onSelect: (network: NetworkProfile) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Network">
      {networks.map((network) => (
        <PresetChip
          key={network.chainId}
          label={shortNameOf(network)}
          selected={network.chainId === selected.chainId}
          onPress={() => onSelect(network)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: tokens.space.sm },
});
