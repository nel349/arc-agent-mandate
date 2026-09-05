import Ionicons from "@expo/vector-icons/Ionicons";
import { Link, Stack } from "expo-router";
import { IconButton } from "../src/ui/IconButton.tsx";
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
          headerRight: () => (
            <Link href="/settings" asChild>
              <IconButton onPress={() => {}} label="Settings" style={{ marginRight: 4 }}>
                <Ionicons name="settings-outline" size={18} color={c.paper} />
              </IconButton>
            </Link>
          ),
        }}
      />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="dev" options={{ title: "Developer harness" }} />
    </Stack>
  );
}
