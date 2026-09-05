import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTheme } from "./theme-context.tsx";
import { tokens } from "./tokens.ts";

/**
 * The lit ground every screen sits on.
 *
 * Light, not colour: three neutral stops of the theme's own temperature, falling from the top
 * right to the bottom left. It exists so the glass above it has real value variation to refract —
 * a panel over a flat fill is just a lighter rectangle, which is the mistake several earlier
 * versions of this design made.
 *
 * The mockup used radial falloffs; React Native has no radial gradient, so this is the diagonal
 * approximation. At phone size the difference does not show.
 */

/**
 * `expo-linear-gradient` is native, so a build that predates it has no module to load. Required
 * behind a guard rather than imported, because a static import fails at module scope where nothing
 * can catch it — and this component is the root of every screen, so that failure is the whole app.
 *
 * Without it the ground is a flat fill: the light is gone and the glass reads flatter, but every
 * screen still works.
 */
const Gradient: null | ((props: Record<string, unknown>) => ReactNode) = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-linear-gradient").LinearGradient;
  } catch {
    console.warn("[ui] expo-linear-gradient unavailable — flat ground. Rebuild the dev client.");
    return null;
  }
})();

export function Screen({ children }: { readonly children: ReactNode }) {
  const c = useTheme().color;
  const content = (
    <ScrollView
      contentContainerStyle={styles.content}
      // Lets iOS apply safe-area insets natively rather than a SafeAreaView wrapper or padding
      // guessed per device.
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );

  if (Gradient === null) {
    return <View style={[styles.fill, { backgroundColor: c.groundMid }]}>{content}</View>;
  }
  return (
    <Gradient
      colors={[c.groundHigh, c.groundMid, c.groundLow]}
      locations={[0, 0.42, 1]}
      start={{ x: 0.9, y: 0 }}
      end={{ x: 0.1, y: 1 }}
      style={styles.fill}
    >
      {content}
    </Gradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // `flexGrow`, not `flex`: a content container with `flex: 1` cannot exceed the viewport, which
  // is the same as not scrolling.
  content: { flexGrow: 1, padding: tokens.space.lg, gap: tokens.space.md },
});
