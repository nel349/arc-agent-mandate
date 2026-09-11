import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * The bar across the top of a full-screen step: a way back, what this step is, and at most one
 * action. Kuira's send wizard draws the same bar, and the amount step puts its Continue here so the
 * number can have the rest of the screen.
 *
 * On the first step the way back is a close, labelled Cancel, because backing out of the first
 * step leaves the flow rather than returning to an earlier part of it.
 */
export function WizardTopBar({
  title, onBack, closes = false, action,
}: {
  readonly title: string;
  readonly onBack: () => void;
  /** This is the first step, so going back closes the flow. */
  readonly closes?: boolean;
  readonly action?: { readonly title: string; readonly enabled: boolean; readonly onPress: () => void };
}) {
  const c = useTheme().color;
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top }}>
      <View style={styles.bar}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={closes ? "Cancel" : "Back"}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name={closes ? "close" : "chevron-back"} size={tokens.size.buttonIcon + 4} color={c.paper} />
        </Pressable>
        <Text style={[styles.title, { color: c.paper }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {action !== undefined && (
          <Pressable
            onPress={action.onPress}
            disabled={!action.enabled}
            accessibilityRole="button"
            accessibilityLabel={action.title}
            accessibilityState={{ disabled: !action.enabled }}
            hitSlop={tokens.space.sm}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={[styles.actionText, { color: action.enabled ? c.paper : c.dim }]}>{action.title}</Text>
          </Pressable>
        )}
      </View>
      <View style={[styles.rule, { backgroundColor: c.hairline }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: tokens.size.topBar,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    paddingHorizontal: tokens.space.sm,
  },
  back: {
    width: tokens.size.tapTarget,
    height: tokens.size.tapTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...tokens.type.headline, flex: 1 },
  action: { paddingHorizontal: tokens.space.md, paddingVertical: tokens.space.sm },
  actionText: tokens.type.headline,
  pressed: { opacity: tokens.opacity.pressed },
  rule: { height: tokens.border.hairline },
});
