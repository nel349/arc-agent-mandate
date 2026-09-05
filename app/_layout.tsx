import { Link, Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet } from "react-native";
import { ThemeProvider, useTheme } from "../src/ui/theme-context.tsx";

const ICON = 22;

const styles = StyleSheet.create({
  /** A box to centre in. No background, so it does not become a second ring inside the one the
   *  navigator already draws for header buttons. */
  headerButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  /**
   * Both halves of the fix, and leaving either out is what kept this off-centre.
   *
   * `lineHeight` equal to the size collapses the font's line box onto the glyph — an icon font's
   * default line box is roughly 1.2x its size, and the extra sits below the baseline, so centring
   * that box leaves the glyph visibly high. `includeFontPadding` removes Android's equivalent.
   */
  headerIcon: {
    lineHeight: ICON,
    includeFontPadding: false,
  },
});

/**
 * The provider wraps the navigator so a palette change reaches every screen at once, including the
 * headers — which are drawn by the navigator rather than by us, and would otherwise stay on
 * whichever theme the app started in.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <Navigator />
    </ThemeProvider>
  );
}

function Navigator() {
  const c = useTheme().color;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.groundMid },
        headerTintColor: c.paper,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.groundMid },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Allowances",
          // Settings is occasional, so it belongs in the chrome rather than in the content. A tab
          // bar would spend a permanent third of the screen on something opened once a month.
          // A bare glyph, with no container of our own.
          //
          // The navigator already draws a pressable background for header buttons, so wrapping
          // ours in a glass circle produced two concentric rings — and the gear was centred in
          // ours while sitting off-centre in theirs. iOS nav bar buttons are plain glyphs; the
          // chrome is the navigator's job, and the touch target comes from hitSlop.
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable
                style={styles.headerButton}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Settings"
              >
                <Ionicons name="settings-outline" size={ICON} color={c.paper} style={styles.headerIcon} />
              </Pressable>
            </Link>
          ),
        }}
      />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="dev" options={{ title: "Developer harness" }} />
    </Stack>
  );
}
