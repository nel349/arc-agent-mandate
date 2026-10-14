import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { draw } from "../test/draw.tsx";
import { ArcRing } from "./ArcRing.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const ring = themeById(DEFAULT_THEME_ID).color.ring;

/** The circles a ring is drawn with: the track first, then the arc of what is left when there is one. */
function circles(container: HTMLElement): readonly SVGCircleElement[] {
  return Array.from(container.querySelectorAll("circle"));
}

/** A colour as the page writes it, whichever way round the drawing library wrote it. */
const strokeOf = (circle: SVGCircleElement | undefined): string => (circle?.getAttribute("stroke") ?? "").toLowerCase();
const same = (colour: string): string => {
  const probe = document.createElement("div");
  probe.style.color = colour;
  return probe.style.color.toLowerCase();
};
const asPainted = (circle: SVGCircleElement | undefined): string => same(strokeOf(circle));

describe("the ring", () => {
  it("is whole, in the colour of what is left, when nothing is spent", () => {
    const { container } = draw(<ArcRing spent={0} label="" />);
    const drawn = circles(container);
    expect(drawn).toHaveLength(1);
    expect(asPainted(drawn[0])).toBe(same(ring.left));
  });

  it("is the track alone when nothing is left, with no bead of life on it", () => {
    const { container } = draw(<ArcRing spent={1} label="" />);
    const drawn = circles(container);
    expect(drawn).toHaveLength(1);
    expect(asPainted(drawn[0])).toBe(same(ring.goneLow));
  });

  it("draws what is left as an arc over the track of what is gone", () => {
    const { container } = draw(<ArcRing spent={0.25} label="" />);
    const drawn = circles(container);
    expect(drawn).toHaveLength(2);
    expect(asPainted(drawn[0])).toBe(same(ring.gone));
    expect(asPainted(drawn[1])).toBe(same(ring.left));
    expect(drawn[1]?.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("changes colour when little is left", () => {
    const { container } = draw(<ArcRing spent={0.95} label="" />);
    const drawn = circles(container);
    expect(asPainted(drawn[0])).toBe(same(ring.goneLow));
    expect(asPainted(drawn[1])).toBe(same(ring.leftLow));
  });

  it("is drawn without colour once its window has closed", () => {
    const { container } = draw(<ArcRing spent={0.4} ended label="" />);
    const drawn = circles(container);
    expect(asPainted(drawn[0])).toBe(same(ring.goneEnded));
    expect(asPainted(drawn[1])).toBe(same(ring.leftEnded));
  });

  it("does not trust a fraction outside nought to one", () => {
    const over = draw(<ArcRing spent={7} label="" />);
    expect(circles(over.container)).toHaveLength(1);
    over.unmount();
    const nonsense = draw(<ArcRing spent={Number.NaN} label="" />);
    expect(circles(nonsense.container).length).toBeGreaterThan(0);
  });

  it("says what it shows when it is the only thing saying it, and stays quiet inside a row that already does", () => {
    draw(<ArcRing spent={0.5} label="10.00 of 20.00 USDC spent" />);
    expect(screen.getByLabelText("10.00 of 20.00 USDC spent")).toBeInTheDocument();
    const quiet = render(<ArcRing spent={0.5} label="" />);
    expect(quiet.container.querySelector("[aria-label]")).toBeNull();
  });

  it("is drawn at the size asked for", () => {
    const { container } = draw(<ArcRing spent={0.5} size={44} label="" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("44");
    expect(svg?.getAttribute("height")).toBe("44");
  });
});
