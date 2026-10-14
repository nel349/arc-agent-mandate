import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { ArcRing } from "../src/ui/ArcRing.tsx";
import { Button } from "../src/ui/Button.tsx";
import { CONNECTED_SITE_KEY, connectedUrl, readConnectRequest } from "../src/ui/connect.ts";
import { writePreference } from "../src/ui/preference-store.ts";
import { shortAddress } from "../src/ui/mandate-format.ts";
import { ERROR_LINES, Note } from "../src/ui/Note.tsx";
import { Screen } from "../src/ui/Screen.tsx";
import { useSession } from "../src/ui/session-context.tsx";
import { useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

/** Enough of the ring drawn to read as a limit partly used, as on the welcome screen. */
const RING = 0.35;

/**
 * A site asking to know which wallet is yours, so it can show you your agents.
 *
 * Outside the tabs, like the welcome screen, because it can arrive before there is a wallet: then it
 * opens one here, with the passkey, and asks once that is done, without losing the request. See
 * `src/ui/connect.ts` for what is and is not sent.
 *
 * **The wallet to connect is always chosen here, with a passkey,** even when one is already open in
 * this browser. The wallet reopens itself at launch, which is right for the phone, and this screen
 * used to take that wallet as the answer and offer only Connect or Cancel: the owner was shown an
 * address they had not picked, with no way to pick another. Now the passkey picker says which
 * wallet, and Create a wallet is beside it, every time.
 *
 * A site usually sends its owner here from a laptop, and the wallet usually lives on their phone.
 * The passkey is what carries it across, and the screen says so, because the other button makes a
 * new wallet, which on a laptop is a second, empty one.
 */
export default function ConnectScreen() {
  const { return: returnTo } = useLocalSearchParams<{ return?: string }>();
  const { wallet } = useSession();
  const c = useTheme().color;
  const request = readConnectRequest(returnTo);
  const [leaving, setLeaving] = useState(false);
  /** The wallet opened on this screen, with a passkey or by creating one. Nothing else is offered. */
  const [chosen, setChosen] = useState<typeof wallet.account>(null);
  /**
   * What was open when the owner pressed a button, so the wallet that answers is known to be a new
   * answer: a closed passkey sheet leaves the old wallet open, and that is not a choice.
   */
  const pressedWith = useRef<typeof wallet.account | undefined>(undefined);
  const open = (how: () => void) => {
    pressedWith.current = wallet.account;
    how();
  };
  useEffect(() => {
    if (pressedWith.current === undefined || wallet.busy) return;
    if (wallet.account !== null && wallet.account !== pressedWith.current) setChosen(wallet.account);
    pressedWith.current = undefined;
  }, [wallet.account, wallet.busy]);

  const go = (url: string) => {
    setLeaving(true);
    // In a browser, this page gives way to the site; a new tab would leave the owner on both.
    if (Platform.OS === "web") globalThis.location.assign(url);
    else void Linking.openURL(url);
  };

  if (!request.ok) {
    return (
      <Screen centered>
        <View style={styles.body}>
          <Text style={[styles.title, { color: c.paper }]}>Nothing to connect</Text>
          <Note tone="warn">{request.problem}</Note>
        </View>
      </Screen>
    );
  }

  if (wallet.restoring) {
    return (
      <Screen centered>
        <View style={styles.body}>
          <ArcRing spent={RING} size={tokens.size.ring.welcome} label="" />
          <Text style={[styles.note, { color: c.dim }]}>Opening your wallet</Text>
        </View>
      </Screen>
    );
  }

  // No wallet chosen here yet: choose one, and the request is still on screen when it opens.
  if (chosen === null) {
    return (
      <Screen
        centered
        footer={
          <>
            <Button tier="solid" title="I already have a passkey" onPress={() => open(wallet.signIn)}
                    busy={wallet.busy} disabled={wallet.busy} />
            <Button title="Create a wallet" onPress={() => open(wallet.create)} disabled={wallet.busy} />
          </>
        }
      >
        <View style={styles.body}>
          <Text style={[styles.title, { color: c.paper }]}>Connect to {request.host}</Text>
          <Text style={[styles.text, { color: c.muted }]}>
            Open the wallet you want to connect, with its passkey. Then you can connect it.
          </Text>
          <Text style={[styles.note, { color: c.dim }]}>
            If your wallet is on your phone, its passkey usually works in this browser too. Create a
            wallet only if you have none: one made here is new and has no agents.
          </Text>
          {wallet.error !== null && <Note tone="warn" lines={ERROR_LINES}>{wallet.error}</Note>}
        </View>
      </Screen>
    );
  }

  const address = chosen.address;
  return (
    <Screen
      centered
      footer={
        <>
          <Button tier="solid" title="Connect" busy={leaving} disabled={leaving}
                  onPress={() => {
                    // Kept so the wallet can link back to this site from an agent's page.
                    void writePreference(CONNECTED_SITE_KEY, request.url).finally(() => go(connectedUrl(request, address)));
                  }} />
          <Button title="Cancel" disabled={leaving} onPress={() => go(request.url)} />
        </>
      }
    >
      <View style={styles.body}>
        <ArcRing spent={RING} size={tokens.size.ring.welcome} label="" />
        <Text style={[styles.title, { color: c.paper }]}>Connect to {request.host}?</Text>
        <Text style={[styles.text, { color: c.muted }]}>
          It will see this wallet's address, {shortAddress(address)}, so it can show you your agents:
          what each may spend, what it is doing, and what it has earned.
        </Text>
        <Text style={[styles.note, { color: c.dim }]}>
          It cannot spend from your wallet or change an allowance. You can disconnect from it at any time.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: "center", gap: tokens.space.base, paddingHorizontal: tokens.space.base },
  title: { ...tokens.type.title, textAlign: "center" },
  text: { ...tokens.type.body, textAlign: "center" },
  note: { ...tokens.type.footnote, textAlign: "center" },
});
