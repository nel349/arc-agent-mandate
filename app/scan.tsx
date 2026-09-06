import { useCallback, useRef, useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../src/ui/Button.tsx";
import { Note } from "../src/ui/Note.tsx";
import { Screen } from "../src/ui/Screen.tsx";
import { tokens } from "../src/ui/tokens.ts";
import { useTheme } from "../src/ui/theme-context.tsx";
import { pairedAddress } from "../src/ui/pairing.ts";

/**
 * `expo-camera`, if this build actually contains it.
 *
 * It is a native module, so a JavaScript-only reload cannot add it — a device running a build from
 * before it was installed throws at *import*, which takes the route's default export with it and
 * leaves the navigator reporting a screen that does not exist. The person sees a red box about
 * `ExpoCamera` and no way forward, on a screen whose entire job is to offer a shortcut.
 *
 * Requiring it behind a guard turns that into a sentence saying which build is needed, with
 * pasting still available. This is the second time in this project a native module has been added
 * without one; the first was `AsyncStorage`, and it white-screened the app.
 */
const camera = (() => {
  try {
    return require("expo-camera") as typeof import("expo-camera");
  } catch {
    return null;
  }
})();

/**
 * Scanning an agent's pairing code.
 *
 * The two halves of this product sit on different devices: the agent runs on a laptop, the wallet
 * is a passkey on a phone. Pairing therefore means moving a 42-character address between them,
 * which was the one genuinely awkward step in the flow and the first one anybody meets. The
 * connector prints a code; this reads it.
 *
 * Pasting still works and is not going anywhere. A camera can be refused, be broken, or be
 * pointed at a screen too dim to read, and a person in any of those situations must not be stuck —
 * so this is a shortcut to the same field, never the only way in.
 */
export default function ScanScreen() {
  if (camera === null) return <CameraMissing />;
  return <Scanner camera={camera} />;
}

/** This build predates the camera. Say which build is needed, and offer the way that still works. */
function CameraMissing() {
  return (
    <Screen>
      <Note tone="warn">
        This build does not include the camera, so scanning is unavailable. Rebuild the app with
        `npx expo run:ios --device` to enable it — a JavaScript reload cannot add a native module.
      </Note>
      <Button tier="solid" title="Paste the address instead" onPress={() => router.back()} />
    </Screen>
  );
}

function Scanner({ camera: { CameraView, useCameraPermissions } }: {
  readonly camera: NonNullable<typeof camera>;
}) {
  const c = useTheme().color;
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * The camera fires continuously once it sees a code, so without this the screen would try to
   * navigate several times from one scan.
   */
  const handled = useRef(false);

  const onScan = useCallback(({ data }: { data: string }) => {
    if (handled.current) return;

    const address = pairedAddress(data);
    if (address === null) {
      // Not latched: the next frame may hold a code that does read as an address, and a person
      // sweeping the camera across a screen should not have to back out and start again.
      setProblem(`That code is not an agent address — it read "${data.slice(0, 24)}…".`);
      return;
    }

    handled.current = true;
    router.replace({ pathname: "/", params: { agent: address } });
  }, []);

  // Permission state is unknown for a moment on first open. Showing the camera prompt before we
  // know whether it is needed makes it look like the app asked twice.
  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <Screen>
        <Note>
          {permission.canAskAgain
            ? "Scanning needs the camera. It is used to read an agent's pairing code and nothing else."
            : "Camera access is turned off for this app. You can turn it on in Settings, or go back and paste the agent's address instead."}
        </Note>
        {permission.canAskAgain && (
          <Button tier="solid" title="Allow the camera" onPress={() => void requestPermission()} />
        )}
        <Button title="Paste it instead" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        // Only the one symbology the connector prints. Anything else is noise the screen would
        // have to reject anyway.
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onScan}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.frame, { borderColor: c.paper }]} />
        <View style={styles.instructions}>
          <Text style={[styles.hint, { color: c.paper }]}>
            Point at the code the agent printed
          </Text>
          {problem !== null && <Note tone="warn" lines={2}>{problem}</Note>}
          <Button title="Paste it instead" onPress={() => router.back()} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    padding: tokens.space.lg,
    gap: tokens.space.xl,
  },
  /** A square to aim with. Sized as a fraction of the screen rather than a fixed number of points. */
  frame: {
    width: "70%",
    aspectRatio: 1,
    borderWidth: 2,
    borderRadius: tokens.radius.lg,
  },
  instructions: { alignSelf: "stretch", gap: tokens.space.md },
  hint: {
    fontFamily: tokens.font.mono,
    fontSize: tokens.font.body,
    textAlign: "center",
  },
});
