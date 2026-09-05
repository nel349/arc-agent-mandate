import { Link, Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable } from "react-native";
import { ThemeProvider, useTheme } from "../src/ui/theme-context.tsx";

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
              <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel="Settings">
                <Ionicons name="settings-outline" size={22} color={c.paper} />
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
