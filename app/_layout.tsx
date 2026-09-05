import { Link, Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet } from "react-native";
import { ThemeProvider, useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

/**
 * The glyph fills the same fraction of its control as every other round control in the app, so a
 * header button and a field `?` look like the same family. Sized independently, an icon ends up
 * looking lost in its own box — which is what a 22pt glyph in a 32pt container was doing.
 */
const HEADER_ICON = Math.round(tokens.size.control.header * tokens.size.glyphScale);

const styles = StyleSheet.create({
  /** A box to centre in. No background, so it cannot become a second ring inside the one the
   *  navigator already draws for header buttons. */
  headerButton: {
    width: tokens.size.control.header,
    height: tokens.size.control.header,
    alignItems: "center",
    justifyContent: "center",
  },
  /**
   * Both halves, and leaving either out is what kept this off-centre.
   *
   * The box above does the centring. `lineHeight` equal to the glyph size collapses the font's
   * line box onto the glyph — an icon font's default box is roughly 1.2x its size and the extra
   * sits below the baseline, so centring that box leaves the glyph visibly high.
   * `includeFontPadding` removes Android's equivalent.
   */
  headerIcon: {
    lineHeight: HEADER_ICON,
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
                hitSlop={Math.round((tokens.size.tapTarget - tokens.size.control.header) / 2)}
                accessibilityRole="button"
                accessibilityLabel="Settings"
              >
                <Ionicons name="settings-outline" size={HEADER_ICON} color={c.paper} style={styles.headerIcon} />
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
