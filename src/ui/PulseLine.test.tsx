import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { FLAT_PATH, REST_PATH, TRACE_MS, TRACE_PATH } from "./motion.ts";
import { PulseLine } from "./PulseLine.tsx";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";

const c = themeById(DEFAULT_THEME_ID).color;

/**
 * jsdom has no `matchMedia`, so the browser's answer to "less motion?" is given here, in the shape a
 * browser gives it: a query that can change while the page is open. The wallet's own hook reads it.
 */
class MotionQuery extends EventTarget {
  matches = false;
  readonly media = "(prefers-reduced-motion: reduce)";
}
const motion = new MotionQuery();
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => motion });
const askForLessMotion = (asked: boolean) => act(() => {
  motion.matches = asked;
  motion.dispatchEvent(Object.assign(new Event("change"), { matches: asked }));
});

const paths = () => Array.from(document.querySelectorAll("svg path"));

describe("the heartbeat line", () => {
  beforeEach(() => askForLessMotion(false));
  afterEach(() => vi.useRealTimers());

  it("is flat in the stop colour when the agent is stopped", () => {
    draw(<PulseLine pulse="stopped" label="Stopped" />);
    expect(paths()).toHaveLength(1);
    expect(paths()[0]).toHaveAttribute("d", FLAT_PATH);
    expect(paths()[0]).toHaveAttribute("stroke", c.stop);
  });

  it("is nearly flat and still when the agent is resting", () => {
    draw(<PulseLine pulse="resting" label="Resting" />);
    expect(paths()).toHaveLength(1);
    expect(paths()[0]).toHaveAttribute("d", REST_PATH);
  });

  it("while spending, has beats in it and a lit part that runs along them", () => {
    vi.useFakeTimers();
    draw(<PulseLine pulse="spending" label="Spending now" />);
    const [line, light] = paths();
    expect(line).toHaveAttribute("d", TRACE_PATH);
    expect(light).toHaveAttribute("d", TRACE_PATH);
    expect(light).toHaveAttribute("stroke", c.untested);
    const before = light?.getAttribute("stroke-dashoffset");
    act(() => vi.advanceTimersByTime(TRACE_MS / 3));
    expect(paths()[1]?.getAttribute("stroke-dashoffset")).not.toBe(before);
  });

  it("with less motion asked for, a spending line is lit end to end and does not move", () => {
    askForLessMotion(true);
    draw(<PulseLine pulse="spending" label="Spending now" />);
    expect(paths()).toHaveLength(1);
    expect(paths()[0]).toHaveAttribute("stroke", c.untested);
    expect(paths()[0]).toHaveAttribute("stroke-opacity", "1");
  });

  it("follows the setting when it changes while the line is on screen", () => {
    draw(<PulseLine pulse="spending" label="Spending now" />);
    expect(paths()).toHaveLength(2);
    askForLessMotion(true);
    expect(paths()).toHaveLength(1);
  });

  it("says what it shows to someone who cannot see it, and nothing when words beside it already do", () => {
    const { unmount } = draw(<PulseLine pulse="spending" label="Spending now" />);
    expect(screen.getByLabelText("Spending now").tagName.toLowerCase()).toBe("svg");
    unmount();
    draw(<PulseLine pulse="spending" label="" />);
    expect(document.querySelector("svg")).not.toHaveAttribute("aria-label");
  });
});
