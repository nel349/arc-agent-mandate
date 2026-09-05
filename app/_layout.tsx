import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useRouter } from "expo-router";
import { Platform, Pressable } from "react-native";
import { ThemeProvider, useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

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
  const router = useRouter();
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
          /**
           * A real UIBarButtonItem, not a React view in a header slot.
           *
           * Every earlier attempt put a custom view there and then tried to make it look native:
           * a glass circle that turned out to duplicate the one iOS 26 already draws around
           * header items, then a plain glyph whose icon-font line box left it sitting high, then
           * a sized box that still would not line up with the OS capsule around it. Each fix
           * moved the problem because the problem was the approach.
           *
           * `unstable_headerRightItems` hands iOS a bar button item with an SF Symbol instead.
           * The system owns the shape, the padding, the tint, the pressed state and the
           * alignment — none of which we can match by hand, and none of which we should be
           * trying to.
           *
           * iOS only — which is why `headerRight` is still supplied below. On iOS the native
           * items override it; on Android a view is the right answer, because there is no bar
           * button item to hand the work to.
           */
          unstable_headerRightItems: () => [
            {
              type: "button",
              label: "Settings",
              icon: { type: "sfSymbol", name: "gearshape" },
              tintColor: c.paper,
              onPress: () => router.push("/settings"),
            },
          ],
          headerRight: () =>
            Platform.OS === "ios" ? null : (
              <Pressable
                onPress={() => router.push("/settings")}
                hitSlop={tokens.space.md}
                accessibilityRole="button"
                accessibilityLabel="Settings"
              >
                <Ionicons name="settings-outline" size={tokens.font.title} color={c.paper} />
              </Pressable>
            ),
        }}
      />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="dev" options={{ title: "Developer harness" }} />
    </Stack>
  );
}
