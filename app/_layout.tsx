import { Stack } from "expo-router";
import { tokens } from "../src/ui/tokens.ts";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: tokens.color.background },
        headerTintColor: tokens.color.text,
        contentStyle: { backgroundColor: tokens.color.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Allowances" }} />
      <Stack.Screen name="dev" options={{ title: "Developer harness" }} />
    </Stack>
  );
}
