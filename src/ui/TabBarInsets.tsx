import { type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

/**
 * Safe-area insets that know the floating tab bar is there.
 *
 * On iOS 26 the tab bar is a capsule floating **over** the screen, not a strip below it, so a tab's
 * content runs underneath it. Scrolling content copes on its own — `react-native-screens` restores
 * UIKit's `automatic` content inset adjustment, which accounts for the bar — but anything positioned
 * against the bottom edge does not, and `Screen`'s footer is exactly that. The result was the bar
 * sitting on top of "New allowance".
 *
 * The height of the bar is not published by `expo-router`'s native tabs, and hard-coding a measured
 * one would be a number that silently rots with the next iOS. So instead of asking how tall the bar
 * is, this asks the view. A nested `SafeAreaProvider` renders a native view and reports **that
 * view's** safe area rather than the window's, and inside a tab that area already has the bar
 * subtracted from it. Every `useSafeAreaInsets()` below this — `Screen`'s footer included — then
 * clears the bar without knowing it exists.
 *
 * Only the two tab screens need it. Screens pushed over the bar (an agent, the activity list,
 * settings) live on the root stack, where the window's own insets are the correct answer.
 */
export function TabBarInsets({ children }: { readonly children: ReactNode }) {
  return <SafeAreaProvider style={styles.fill}>{children}</SafeAreaProvider>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
