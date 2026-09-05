import { Stack } from "expo-router";
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
      <Stack.Screen name="index" options={{ title: "Allowances" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="dev" options={{ title: "Developer harness" }} />
    </Stack>
  );
}
