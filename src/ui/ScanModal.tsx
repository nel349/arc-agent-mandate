import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useRef, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
 * needed, with typing the address still available.
 */
const camera = (() => {
  try {
    return require("expo-camera") as typeof import("expo-camera");
  } catch {
    return null;
  }
})();

/**
 * Reading an agent's pairing code, full screen.
 *
 * **Laid out the way Apple lays out its own scanner**: the camera fills the screen, a close button
 * sits at the top leading corner and the torch at the top trailing one, the code is aimed at inside
 * a marked square with everything around it dimmed, and the other way of doing the same job sits
 * at the bottom where a thumb is. The previous version had a thin outline and a single button at
 * the bottom, so the only way out read as giving up, and there was no light for a code on a dim
 * screen.
 *
 * The square is drawn as four corner brackets, the same frame the maze's web page draws, so the
 * one moment the phone and the site meet looks like one product.
 *
 * **A modal, not a route.** Scanning is not a destination — it is a way of filling in one field,
 * and the value belongs to the screen that opened it. Owned by that screen, it is a callback and a
 * piece of state rather than route params used as a message channel.
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
      presentationStyle="fullScreen"
      // Android's back button. On iOS the close button is the way out, as a full-screen camera has
      // no swipe to dismiss.
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
        This build does not include the camera, so scanning is unavailable. Rebuild the app from
        Xcode; a JavaScript reload cannot add a native module.
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
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);

  /** The camera fires on every frame it can read, so one code would otherwise arrive many times. */
  const handled = useRef(false);

  const onBarcode = useCallback(({ data }: { data: string }) => {
    if (handled.current) return;
    const address = pairedAddress(data);
    if (address === null) {
      // Not latched: the next frame may hold something readable, and someone sweeping a camera
      // across a screen should not have to close and reopen after one bad read.
      setProblem(`That code is not an agent address. It read "${data.slice(0, 24)}…".`);
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
        <Ionicons name="qr-code-outline" size={tokens.size.ring.row} color={c.muted} style={styles.centered} />
        {permission.canAskAgain ? (
          <>
            {/*
              No way out on this screen, on purpose. Apple asks that a screen shown before the
              system's camera prompt lead to that prompt, not around it; the prompt itself has
              "Don't Allow", which is the honest place to decline.
            */}
            <Text style={[styles.permissionTitle, { color: c.paper }]}>Scan with the camera</Text>
            <Text style={[styles.permissionBody, { color: c.muted }]}>
              The app reads the agent's pairing code and nothing else. Nothing is recorded.
            </Text>
            <Button tier="solid" title="Continue" onPress={() => void requestPermission()} />
          </>
        ) : (
          <>
            <Text style={[styles.permissionTitle, { color: c.paper }]}>Camera access is off</Text>
            <Text style={[styles.permissionBody, { color: c.muted }]}>
              Turn it on for this app in Settings to scan, or type the agent's address instead.
            </Text>
            <Button tier="solid" title="Open Settings" onPress={() => void Linking.openSettings()} />
            <Button title="Type the address instead" onPress={onClose} />
          </>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: SCRIM_BASE }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onBarcode}
      />

      {/* The dimmed surround and the square, as one column so the square stays centred. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.scrim, styles.grow]} />
        <View style={styles.middle}>
          <View style={[styles.scrim, styles.grow]} />
          <View style={styles.square}>
            <Corner at="topLeft" />
            <Corner at="topRight" />
            <Corner at="bottomLeft" />
            <Corner at="bottomRight" />
          </View>
          <View style={[styles.scrim, styles.grow]} />
        </View>
        <View style={[styles.scrim, styles.grow]} />
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + tokens.space.sm }]}>
        <RoundButton icon="close" label="Close the camera" onPress={onClose} />
        <RoundButton
          icon={torch ? "flashlight" : "flashlight-outline"}
          label={torch ? "Turn the light off" : "Turn the light on"}
          onPress={() => setTorch((on) => !on)}
          lit={torch}
        />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + tokens.space.base }]}>
        <Text style={[styles.hint, { color: SCANNER_INK }]}>Point at the code your agent printed</Text>
        {problem !== null && <Note tone="warn" lines={2}>{problem}</Note>}
        <Button title="Type or paste the address" onPress={onClose} />
      </View>
    </View>
  );
}

/** Over live video the palette's glass disappears, so these sit on a fixed dark disc. */
function RoundButton({
  icon, label, onPress, lit = false,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
  readonly lit?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: lit }}
      style={[styles.round, lit && styles.roundLit]}
    >
      <Ionicons name={icon} size={tokens.size.buttonIcon} color={lit ? SCRIM_BASE : SCANNER_INK} />
    </Pressable>
  );
}

type CornerAt = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** One L-shaped bracket, drawn with two borders of a square box. */
function Corner({ at }: { readonly at: CornerAt }) {
  return <View style={[styles.corner, CORNERS[at]]} />;
}

/**
 * Colours for the one screen that sits on live video rather than on the theme's ground.
 *
 * Fixed rather than taken from the palette: the camera image can be anything from a white page to
 * a dark room, so the controls need their own contrast, the way the system camera's do.
 */
const SCANNER_INK = "#FFFFFF";
const SCRIM_BASE = "#000000";
const SCRIM_OPACITY = 0.55;
/** The square's side, as a share of the screen's width. */
const SQUARE_SHARE = "72%";
const CORNER_LENGTH = 34;
const CORNER_STROKE = 4;

const CORNERS: Readonly<Record<CornerAt, object>> = {
  topLeft: { top: 0, left: 0, borderTopWidth: CORNER_STROKE, borderLeftWidth: CORNER_STROKE, borderTopLeftRadius: tokens.radius.md },
  topRight: { top: 0, right: 0, borderTopWidth: CORNER_STROKE, borderRightWidth: CORNER_STROKE, borderTopRightRadius: tokens.radius.md },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: CORNER_STROKE, borderLeftWidth: CORNER_STROKE, borderBottomLeftRadius: tokens.radius.md },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: CORNER_STROKE, borderRightWidth: CORNER_STROKE, borderBottomRightRadius: tokens.radius.md },
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  centered: { alignSelf: "center" },
  fallback: { flex: 1, justifyContent: "center", padding: tokens.space.lg, gap: tokens.space.md },
  permissionTitle: { ...tokens.type.title, textAlign: "center" },
  permissionBody: { ...tokens.type.body, textAlign: "center" },
  scrim: { backgroundColor: `rgba(0, 0, 0, ${SCRIM_OPACITY})` },
  // Its height is the square's, so the scrims either side of the square fill exactly that band.
  middle: { flexDirection: "row" },
  square: { width: SQUARE_SHARE, aspectRatio: 1 },
  corner: {
    position: "absolute",
    width: CORNER_LENGTH,
    height: CORNER_LENGTH,
    borderColor: SCANNER_INK,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
  },
  round: {
    width: tokens.size.tapTarget,
    height: tokens.size.tapTarget,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: `rgba(0, 0, 0, ${SCRIM_OPACITY})`,
  },
  roundLit: { backgroundColor: SCANNER_INK },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: tokens.space.lg,
    gap: tokens.space.md,
  },
  hint: { ...tokens.type.headline, textAlign: "center" },
});
