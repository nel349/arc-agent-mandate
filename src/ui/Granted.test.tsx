import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { Granted } from "./Granted.tsx";

/** The halo: the drawn view laid over the ring, sized as the ring is. */
const haloOf = (container: HTMLElement): HTMLElement | null =>
  Array.from(container.querySelectorAll<HTMLElement>("div")).find((div) => div.className.includes("r-pointerEvents")) ?? null;

describe("the granted moment", () => {
  it("is a whole ring, all of it left, at the size of the review", () => {
    const { container } = draw(<Granted />);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("120");
  });

  it("beats once as it appears, because something has just happened", async () => {
    const { container } = draw(<Granted />);
    await new Promise((done) => setTimeout(done, 60));
    expect(Number(haloOf(container)?.style.opacity)).toBeGreaterThan(0);
    await new Promise((done) => setTimeout(done, 1_100));
    expect(Number(haloOf(container)?.style.opacity)).toBe(0);
  });

  it("says nothing of its own to a screen reader: the card above it has said it", () => {
    const { container } = draw(<Granted />);
    expect(container.querySelector("[aria-label]")).toBeNull();
  });
});
