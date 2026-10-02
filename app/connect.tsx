import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
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
 */
export default function ConnectScreen() {
  const { return: returnTo } = useLocalSearchParams<{ return?: string }>();
  const { wallet } = useSession();
  const c = useTheme().color;
  const request = readConnectRequest(returnTo);
  const [leaving, setLeaving] = useState(false);

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

  // No wallet yet: open one first, here, and the request is still on screen when it opens.
  if (wallet.account === null) {
    return (
      <Screen
        centered
        footer={
          <>
            <Button tier="solid" title="I already have a passkey" onPress={wallet.signIn}
                    busy={wallet.busy} disabled={wallet.busy} />
            <Button title="Create a wallet" onPress={wallet.create} disabled={wallet.busy} />
          </>
        }
      >
        <View style={styles.body}>
          <Text style={[styles.title, { color: c.paper }]}>Connect to {request.host}</Text>
          <Text style={[styles.text, { color: c.muted }]}>
            Open your wallet first, with your passkey. Then you can connect it.
          </Text>
          {wallet.error !== null && <Note tone="warn" lines={ERROR_LINES}>{wallet.error}</Note>}
        </View>
      </Screen>
    );
  }

  const address = wallet.account.address;
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
