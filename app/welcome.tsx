import { Redirect } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ArcRing } from "../src/ui/ArcRing.tsx";
import { Button } from "../src/ui/Button.tsx";
import { ERROR_LINES, Note } from "../src/ui/Note.tsx";
import { ROUTES } from "../src/ui/routes.ts";
import { Screen } from "../src/ui/Screen.tsx";
import { useSession } from "../src/ui/session-context.tsx";
import { useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

/**
 * The first screen anyone sees, and the only one that exists before there is a wallet.
 *
 * **Outside the tabs on purpose.** It used to be a branch inside the allowances tab, which meant the
 * native tab bar drew underneath it: somebody who had not yet created a wallet was offered
 * Allowances and Rewards, two tabs that can only be empty, before being offered a wallet. A screen
 * that precedes the app does not belong inside the app's navigation.
 *
 * The gate is two redirects that cannot both fire: the tab group sends anyone with no account here,
 * and this screen sends anyone with an account back. Nothing polls and nothing decides twice.
 */
export default function WelcomeScreen() {
  const { wallet } = useSession();

  // Reopening a remembered wallet takes a moment, and showing two big buttons during it puts
  // "Create a wallet" in front of somebody who already has one.
  if (wallet.restoring) return <Opening />;
  if (wallet.account !== null) return <Redirect href={ROUTES.allowances} />;
  return <Welcome />;
}

/**
 * What the app is for, before asking for anything.
 *
 * It used to say "No wallet yet" over two buttons and nothing else. It now shows the ring as the
 * idea and says what a passkey means here, because "Create a wallet" is a big ask from an app that
 * has not yet said why.
 */
function Welcome() {
  const { wallet } = useSession();
  const c = useTheme().color;
  /**
   * Which of the two was tapped, so only that one spins. Both used to take `wallet.busy`, and
   * tapping either put a spinner on both.
   */
  const [chosen, setChosen] = useState<"create" | "signIn" | null>(null);
  const working = (which: "create" | "signIn") => wallet.busy && chosen === which;

  return (
    <Screen
      centered
      footer={
        <>
          <Button
            tier="solid"
            title="Create a wallet"
            onPress={() => { setChosen("create"); wallet.create(); }}
            busy={working("create")}
            disabled={wallet.busy}
          />
          <Button
            title="I already have a passkey"
            onPress={() => { setChosen("signIn"); wallet.signIn(); }}
            busy={working("signIn")}
            disabled={wallet.busy}
          />
        </>
      }
    >
      <View style={styles.welcome}>
        <ArcRing spent={WELCOME_RING} size={tokens.size.ring.welcome} label="" />
        <Text style={[styles.welcomeTitle, { color: c.paper }]}>Let an agent spend, within limits</Text>
        <Text style={[styles.welcomeBody, { color: c.muted }]}>
          Give an AI agent an allowance in USDC. It can spend up to the limit you set, until the
          date you choose, and you can take it back at any time.
        </Text>
        <Text style={[styles.welcomeNote, { color: c.dim }]}>
          Your wallet opens with Face ID. There is no password, and nothing to write down.
        </Text>
        {wallet.error !== null && <Note tone="warn" lines={ERROR_LINES}>{wallet.error}</Note>}
      </View>
    </Screen>
  );
}

/** Between launch and the wallet: the ring and one line. */
function Opening() {
  const c = useTheme().color;
  return (
    <Screen centered>
      <View style={styles.welcome}>
        <ArcRing spent={WELCOME_RING} size={tokens.size.ring.welcome} label="" />
        <Text style={[styles.welcomeNote, { color: c.dim }]}>Opening your wallet</Text>
      </View>
    </Screen>
  );
}

/** Enough of the ring drawn to read as a limit partly used, which is the whole idea in one shape. */
const WELCOME_RING = 0.35;

const styles = StyleSheet.create({
  // Centred vertically by `Screen centered`; this only centres across and spaces the parts.
  welcome: {
    alignItems: "center",
    gap: tokens.space.base,
    paddingHorizontal: tokens.space.base,
  },
  welcomeTitle: { ...tokens.type.title, textAlign: "center" },
  welcomeBody: { ...tokens.type.body, textAlign: "center" },
  welcomeNote: { ...tokens.type.footnote, textAlign: "center" },
});
