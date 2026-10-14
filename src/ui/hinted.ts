import { Platform } from "react-native";

/**
 * A control's name and its hint, as props the platform reads.
 *
 * A phone reads `accessibilityHint` after the name, a moment later. react-native-web 0.21 has no such
 * prop and drops it without a word, so in the web wallet "Opens the receipt" and every other hint was
 * never heard (docs/FINDINGS.md, 17). There the hint follows the name in the one name the browser
 * gives the control, which is what a screen reader reads.
 */
export function hinted(label: string, hint: string | undefined): { accessibilityLabel: string; accessibilityHint?: string } {
  if (hint === undefined) return { accessibilityLabel: label };
  if (Platform.OS !== "web") return { accessibilityLabel: label, accessibilityHint: hint };
  // One full stop between them, whether or not the name already ends with one.
  return { accessibilityLabel: `${label}${label.endsWith(".") ? "" : "."} ${hint}` };
}
