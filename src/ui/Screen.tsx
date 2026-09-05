import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * The lit ground every screen sits on.
 *
 * Light, not colour: three neutral stops of the theme's own temperature, falling from the top
 * right to the bottom left. It exists so the glass above it has real value variation to refract —
 * a panel over a flat fill is just a lighter rectangle, which is the mistake the first five
 * attempts at this design made.
 *
 * The mockup used radial falloffs; React Native has no radial gradient, so this is the diagonal
 * approximation. At phone size the difference is not visible, and a native dependency for a
 * rounder falloff would not be worth it.
 */
export function Screen({ children }: { readonly children: ReactNode }) {
  const c = useTheme().color;
  return (
    <LinearGradient
      colors={[c.groundHigh, c.groundMid, c.groundLow]}
      locations={[0, 0.42, 1]}
      start={{ x: 0.9, y: 0 }}
      end={{ x: 0.1, y: 1 }}
      style={styles.fill}
    >
      <View style={styles.content}>{children}</View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flex: 1, padding: tokens.space.lg, gap: tokens.space.md },
});
