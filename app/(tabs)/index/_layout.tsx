import { Stack } from "expo-router";
import { stackChrome, TOP_LEVEL_SCREEN } from "../../../src/ui/navigation-chrome.ts";
import { SettingsButton } from "../../../src/ui/SettingsButton.tsx";
import { TabBarInsets } from "../../../src/ui/TabBarInsets.tsx";
import { useTheme } from "../../../src/ui/theme-context.tsx";

/**
 * The allowances tab's own stack.
 *
 * A stack per tab rather than one around the bar: it is what keeps the native large title, and what
 * would let this tab push a screen of its own without the other tab's history coming with it.
 */
export default function AllowancesLayout() {
  const c = useTheme().color;
  return (
    // So "New allowance" sits above the floating bar rather than under it. See `TabBarInsets`.
    <TabBarInsets>
      <Stack screenOptions={stackChrome(c)}>
        <Stack.Screen
          name="index"
          options={{
            title: "Allowances",
            ...TOP_LEVEL_SCREEN,
            // Settings is occasional, so it belongs in the chrome rather than in the content.
            headerRight: () => <SettingsButton />,
          }}
        />
      </Stack>
    </TabBarInsets>
  );
}
