import { StyleSheet, View } from "react-native";

type CornerAt = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
const ALL: readonly CornerAt[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

/**
 * Four L-shaped brackets at the corners of whatever holds them: the frame the scanner aims with, and
 * the tile that opens it. The parent sets the size; the marks sit on its edges and take no space.
 * An allowance card used to be printed inside them too, when it was drawn as a key listing.
 */
export function CornerMarks({
  color, length, stroke, radius = 0,
}: {
  readonly color: string;
  /** each arm of a bracket */
  readonly length: number;
  readonly stroke: number;
  /** rounding at the bracket's corner; square by default */
  readonly radius?: number;
}) {
  return (
    <>
      {ALL.map((at) => (
        <View
          key={at}
          pointerEvents="none"
          style={[styles.mark, { width: length, height: length, borderColor: color }, placed(at, stroke, radius)]}
        />
      ))}
    </>
  );
}

/** One bracket: two borders of a square box, on the corner it belongs to. */
function placed(at: CornerAt, stroke: number, radius: number): object {
  switch (at) {
    case "topLeft": return { top: 0, left: 0, borderTopWidth: stroke, borderLeftWidth: stroke, borderTopLeftRadius: radius };
    case "topRight": return { top: 0, right: 0, borderTopWidth: stroke, borderRightWidth: stroke, borderTopRightRadius: radius };
    case "bottomLeft": return { bottom: 0, left: 0, borderBottomWidth: stroke, borderLeftWidth: stroke, borderBottomLeftRadius: radius };
    case "bottomRight": return { bottom: 0, right: 0, borderBottomWidth: stroke, borderRightWidth: stroke, borderBottomRightRadius: radius };
  }
}

const styles = StyleSheet.create({
  mark: { position: "absolute" },
});
