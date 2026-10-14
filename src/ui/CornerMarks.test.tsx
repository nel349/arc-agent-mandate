import { screen } from "@testing-library/react";
import { View } from "react-native";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { CornerMarks } from "./CornerMarks.tsx";

const marksIn = (frame: HTMLElement): HTMLElement[] => Array.from(frame.children) as HTMLElement[];

describe("the corner marks", () => {
  it("draws four brackets, one on each corner, each two strokes of the given length", () => {
    draw(<View testID="frame"><CornerMarks color="#FFFFFF" length={34} stroke={4} /></View>);
    const marks = marksIn(screen.getByTestId("frame"));
    expect(marks).toHaveLength(4);
    for (const mark of marks) expect(mark).toHaveStyle({ width: "34px", height: "34px", borderColor: "#FFFFFF" });
    const [topLeft, topRight, bottomLeft, bottomRight] = marks;
    expect(topLeft).toHaveStyle({ top: "0px", left: "0px", borderTopWidth: "4px", borderLeftWidth: "4px" });
    expect(topRight).toHaveStyle({ top: "0px", right: "0px", borderTopWidth: "4px", borderRightWidth: "4px" });
    expect(bottomLeft).toHaveStyle({ bottom: "0px", left: "0px", borderBottomWidth: "4px", borderLeftWidth: "4px" });
    expect(bottomRight).toHaveStyle({ bottom: "0px", right: "0px", borderBottomWidth: "4px", borderRightWidth: "4px" });
  });

  it("a bracket draws only its own two sides, so it reads as a corner and not a box", () => {
    draw(<View testID="frame"><CornerMarks color="#FFFFFF" length={20} stroke={3} /></View>);
    const [topLeft] = marksIn(screen.getByTestId("frame"));
    expect(topLeft?.style.borderBottomWidth).toBe("");
    expect(topLeft?.style.borderRightWidth).toBe("");
  });

  it("rounds each bracket at its own corner when asked, and is square otherwise", () => {
    draw(<View testID="round"><CornerMarks color="#FFFFFF" length={20} stroke={3} radius={14} /></View>);
    const [topLeft, topRight, bottomLeft, bottomRight] = marksIn(screen.getByTestId("round"));
    expect(topLeft).toHaveStyle({ borderTopLeftRadius: "14px" });
    expect(topRight).toHaveStyle({ borderTopRightRadius: "14px" });
    expect(bottomLeft).toHaveStyle({ borderBottomLeftRadius: "14px" });
    expect(bottomRight).toHaveStyle({ borderBottomRightRadius: "14px" });
  });

  it("never takes a touch meant for what is under it", () => {
    draw(<View testID="frame"><CornerMarks color="#FFFFFF" length={20} stroke={3} /></View>);
    for (const mark of marksIn(screen.getByTestId("frame"))) expect(mark).toHaveStyle({ pointerEvents: "none" });
  });
});
