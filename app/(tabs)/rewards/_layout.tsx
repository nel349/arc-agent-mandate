import { Stack } from "expo-router";
import { stackChrome, TOP_LEVEL_SCREEN } from "../../../src/ui/navigation-chrome.ts";
import { TabBarInsets } from "../../../src/ui/TabBarInsets.tsx";
import { useTheme } from "../../../src/ui/theme-context.tsx";

/** The rewards tab's own stack, drawn from the same chrome as the allowances tab so the two read
 *  as one app rather than as two that happen to be next to each other. */
export default function RewardsLayout() {
  const c = useTheme().color;
  return (
    // The badge screen's buttons sit at the end of its content, but a long list of badges scrolls
    // under the bar just the same. See `TabBarInsets`.
    <TabBarInsets>
      <Stack screenOptions={stackChrome(c)}>
        <Stack.Screen name="index" options={{ title: "Rewards", ...TOP_LEVEL_SCREEN }} />
      </Stack>
    </TabBarInsets>
  );
}
