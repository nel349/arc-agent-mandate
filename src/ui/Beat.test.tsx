import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Beat } from "./Beat.tsx";

// Drawn with react-native-web's real animation engine, which `vitest.setup.ts` asks for for every test.

/** How visible the halo is right now. */
const opacityOf = (container: HTMLElement): number => Number((container.firstChild as HTMLElement | null)?.style.opacity ?? Number.NaN);
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("a beat", () => {
  it("is a halo the size of its ring, which takes no touches", () => {
    const { container } = render(<Beat count={0} size={44} color="#00ff00" />);
    const halo = container.firstChild as HTMLElement;
    expect(halo.style.width).toBe("44px");
    expect(halo.style.height).toBe("44px");
    expect(halo.className).toMatch(/r-pointerEvents/);
  });

  it("shows nothing when the screen first appears: that would be a beat for a payment nobody made", async () => {
    const { container } = render(<Beat count={3} size={44} color="#00ff00" />);
    await wait(50);
    expect(opacityOf(container)).toBe(0);
  });

  it("leaves the ring when a payment lands, and is gone again after", async () => {
    const { container, rerender } = render(<Beat count={0} size={44} color="#00ff00" />);
    rerender(<Beat count={1} size={44} color="#00ff00" />);
    await wait(60);
    const leaving = opacityOf(container);
    expect(leaving).toBeGreaterThan(0);
    expect(leaving).toBeLessThanOrEqual(0.55);
    await wait(1_100);
    expect(opacityOf(container)).toBe(0);
  });

  it("does not beat when the count goes down, which is the example starting again", async () => {
    const { container, rerender } = render(<Beat count={5} size={44} color="#00ff00" />);
    rerender(<Beat count={0} size={44} color="#00ff00" />);
    await wait(60);
    expect(opacityOf(container)).toBe(0);
  });
});
