import { Stack } from "expo-router";
import { useEffect } from "react";
import { AgentNamesProvider } from "../src/ui/agent-names-context.tsx";
import { applyStoredEndpoint } from "../src/ui/endpoint-setting.ts";
import { stackChrome } from "../src/ui/navigation-chrome.ts";
import { SessionProvider } from "../src/ui/session-context.tsx";
import { ThemeProvider, useTheme } from "../src/ui/theme-context.tsx";

/** A bar with no fill of its own, over a screen that paints its own ground. */
const TRANSPARENT = "transparent";

/** The receipt's resting height, as a fraction of the screen: the figure and its four rows. */
const RECEIPT_HEIGHT = 0.62;

/**
 * The providers wrap the navigator so every screen, including the headers the navigator draws,
 * reads one palette, one wallet and one set of agent names.
 *
 * The session sits above the navigator rather than inside a screen because the app now has more
 * than one: the list, an agent's own screen and the grant sheet all show the same account, and a
 * wallet held by one screen's state is a wallet the next screen cannot see.
 */
export default function RootLayout() {
  // Before any screen reads Arc, point the reads at the endpoint this phone was given, if it was
  // given one. Above the providers because every screen under them reads the chain, and none of
  // them should have to know where from.
  useEffect(() => { void applyStoredEndpoint(); }, []);

  return (
    <ThemeProvider>
      <SessionProvider>
        <AgentNamesProvider>
          <Navigator />
        </AgentNamesProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

function Navigator() {
  const c = useTheme().color;
  return (
    <Stack
      screenOptions={{
        ...stackChrome(c),
        // The one difference from a tab's stack: these screens are pushed over the app rather than
        // laid on its gradient, so their bar has a fill of its own.
        headerStyle: { backgroundColor: c.groundMid },
      }}
    >
      {/*
        The two top-level screens, each a tab with a stack of its own: what your agents may spend,
        and what they have earned. The bar is the platform's own — see `app/(tabs)/_layout.tsx` —
        so this stack shows no header of its own over it.
      */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* Before the app: no bar, and no title over a screen that cannot have allowances yet. */}
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      {/* Pushed: drilling into one item of the list. Its title is the agent's name, set by the
          screen once it knows it. */}
      <Stack.Screen
        name="agent/[address]"
        options={{
          title: "",
          headerTransparent: true,
          headerStyle: { backgroundColor: TRANSPARENT },
          headerBackTitle: "Allowances",
        }}
      />
      {/* Full screen, drawing its own bar: a flow of several steps, as Kuira's send is, and as
          Apple places a multi-step task. Each step takes the whole screen, and the bar's Cancel
          and Back are the ways out. */}
      <Stack.Screen name="grant" options={{ presentation: "fullScreenModal", headerShown: false }} />
      <Stack.Screen name="activity" options={{ title: "Activity", headerBackTitle: "Back" }} />
      {/* Half height: a receipt is a glance at one row, with the list still showing above it. */}
      <Stack.Screen
        name="receipt"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: [RECEIPT_HEIGHT, 1],
          sheetGrabberVisible: true,
          title: "",
        }}
      />
      {/* Named, or the back button reads "(tabs)" — the route group's own name, which is an
          implementation detail of the file tree and not a place anybody has been. */}
      <Stack.Screen name="settings" options={{ title: "Settings", headerBackTitle: "Back" }} />
      <Stack.Screen name="dev" options={{ title: "Developer harness" }} />
      <Stack.Screen name="preview" options={{ title: "Component preview" }} />
    </Stack>
  );
}
