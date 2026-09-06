import { useCallback, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button.tsx";
import { Note } from "./Note.tsx";
import { pairedAddress } from "./pairing.ts";
import { tokens } from "./tokens.ts";
import { useTheme } from "./theme-context.tsx";

/**
 * `expo-camera`, if this build actually contains it.
 *
 * It is a native module, so a JavaScript-only reload cannot add it — a build from before it was
 * installed throws at *import*. Behind a guard that becomes a sentence saying which build is
 * needed, with pasting still available.
 */
const camera = (() => {
  try {
    return require("expo-camera") as typeof import("expo-camera");
  } catch {
    return null;
  }
})();

/**
 * Reading an agent's pairing code.
 *
 * **A modal, not a route.** Scanning is not a destination — it is a way of filling in one field,
 * and the value belongs to the screen that opened it. As a route it had to hand that value back,
 * which meant route params used as a message channel: the address then lived in navigation
 * history, replayed when you came back, and had to be explicitly cleared or it refilled a field
 * you had emptied on purpose. Returning from it also had to pick correctly between `replace`,
 * which swapped the modal for the home screen and left the home screen rendered *inside* a sheet,
 * and `dismissTo`, which did not.
 *
 * Owned by the screen that wants the value, none of that exists: it is a callback and a piece of
 * state. What is left in `app/` is the four things that are genuinely destinations.
 */
export function ScanModal({
  visible, onClose, onScanned,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Called with a valid address. The modal does not close itself; the owner decides. */
  readonly onScanned: (address: `0x${string}`) => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      // Full screen, because a viewfinder in a card reads as a picture of a camera.
      presentationStyle="fullScreen"
      // Android's back button, and iOS's swipe. A modal with no way out is a trap.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {camera === null ? (
        <Unavailable onClose={onClose} />
      ) : (
        <Viewfinder camera={camera} onClose={onClose} onScanned={onScanned} />
      )}
    </Modal>
  );
}

/** This build predates the camera. Name the build that fixes it, and offer the way that works now. */
function Unavailable({ onClose }: { readonly onClose: () => void }) {
  const c = useTheme().color;
  return (
    <View style={[styles.fallback, { backgroundColor: c.groundMid }]}>
      <Note tone="warn">
        This build does not include the camera, so scanning is unavailable. Rebuild with
        `npx expo run:ios --device` — a JavaScript reload cannot add a native module.
      </Note>
      <Button tier="solid" title="Type the address instead" onPress={onClose} />
    </View>
  );
}

function Viewfinder({
  camera: { CameraView, useCameraPermissions }, onClose, onScanned,
}: {
  readonly camera: NonNullable<typeof camera>;
  readonly onClose: () => void;
  readonly onScanned: (address: `0x${string}`) => void;
}) {
  const c = useTheme().color;
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState<string | null>(null);

  /** The camera fires on every frame it can read, so one code would otherwise arrive many times. */
  const handled = useRef(false);

  const onBarcode = useCallback(({ data }: { data: string }) => {
    if (handled.current) return;
    const address = pairedAddress(data);
    if (address === null) {
      // Not latched: the next frame may hold something readable, and someone sweeping a camera
      // across a screen should not have to close and reopen after one bad read.
      setProblem(`That code is not an agent address — it read "${data.slice(0, 24)}…".`);
      return;
    }
    handled.current = true;
    onScanned(address);
  }, [onScanned]);

  // Permission is unknown for a moment on first open. Showing anything here makes it look like
  // the app asked twice.
  if (!permission) return <View style={[styles.fill, { backgroundColor: c.groundLow }]} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fallback, { backgroundColor: c.groundMid }]}>
        <Note>
          {permission.canAskAgain
            ? "Scanning needs the camera. It reads an agent's pairing code and nothing else."
            : "Camera access is off for this app. Turn it on in Settings, or type the agent's address instead."}
        </Note>
        {permission.canAskAgain && (
          <Button tier="solid" title="Allow the camera" onPress={() => void requestPermission()} />
        )}
        <Button title="Type the address instead" onPress={onClose} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onBarcode}
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.frame, { borderColor: c.paper }]} />
        <View style={styles.instructions}>
          <Text style={[styles.hint, { color: c.paper }]}>Point at the code the agent printed</Text>
          {problem !== null && <Note tone="warn" lines={2}>{problem}</Note>}
          <Button title="Type the address instead" onPress={onClose} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { flex: 1, justifyContent: "center", padding: tokens.space.lg, gap: tokens.space.md },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    padding: tokens.space.lg,
    gap: tokens.space.xl,
  },
  /** Something to aim with, sized as a fraction of the screen rather than a fixed number of points. */
  frame: { width: "70%", aspectRatio: 1, borderWidth: 2, borderRadius: tokens.radius.lg },
  instructions: { alignSelf: "stretch", gap: tokens.space.md },
  hint: { fontFamily: tokens.font.mono, fontSize: tokens.font.body, textAlign: "center" },
});
