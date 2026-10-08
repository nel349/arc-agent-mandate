import { StyleSheet, View } from "react-native";
import { Button } from "./Button.tsx";
import { ALREADY_GRANTED } from "./failure.ts";
import { Note } from "./Note.tsx";
import { tokens } from "./tokens.ts";

/**
 * Said when the agent just scanned, pasted or typed already has an allowance from this wallet, with
 * the way to the one thing that can be done about it.
 *
 * The plugin allows one allowance per agent per wallet, so the grant cannot go on. It used to be said
 * in a quiet line at the foot of a screen whose scanner had just closed without moving on, which on a
 * phone read as the scan having done nothing (8 October 2026). So it is said as a warning, where the
 * scan was, and it opens the agent's own screen, which is where an allowance is revoked.
 */
export function AlreadyGranted({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <View style={styles.block}>
      <Note tone="warn">{ALREADY_GRANTED}</Note>
      <Button title="Open This Agent's Allowance" onPress={onOpen} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: tokens.space.sm },
});
