import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draw } from "../test/draw.tsx";
import { DEMO_STEP_MS } from "./motion.ts";
import { tokens } from "./tokens.ts";
import { WelcomeExample } from "./WelcomeExample.tsx";
import { DEMO_EVENTS, DEMO_LIMIT, DEMO_STEPS, DEMO_STILL_STEP, REFUSED_BECAUSE, demoFigure, demoFrame } from "./welcome-demo.ts";

/** As in PulseLine's tests: jsdom has no `matchMedia`, so the browser's answer is given in its own shape. */
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

/**
 * A window of that height, told the way a browser tells react-native-web: jsdom lays nothing out, so
 * the page's height reads as nought, which is the tiny window, until it is given one.
 */
const windowOf = (height: number) => act(() => {
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: height });
  window.dispatchEvent(new Event("resize"));
});
const TALL = 800;

const LIMIT = `${demoFigure(DEMO_LIMIT)} USDC`;
const gauge = () => screen.getByLabelText(/^An example\./);
const step = (count = 1) => act(() => vi.advanceTimersByTime(DEMO_STEP_MS * count));
const refused = DEMO_EVENTS.find((event) => event.refused === true)!;

describe("the example on the welcome screen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    askForLessMotion(false);
    windowOf(TALL);
  });
  afterEach(() => vi.useRealTimers());

  it("says it is an example, and what its limit is", () => {
    draw(<WelcomeExample unit="USDC" />);
    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(screen.getByText(`${LIMIT} limit`)).toBeInTheDocument();
  });

  it("starts from the beginning: granted, all of it left, waiting for the first payment", () => {
    draw(<WelcomeExample unit="USDC" />);
    expect(screen.getByText("Granted")).toBeInTheDocument();
    expect(gauge()).toHaveAttribute("aria-label", `An example. ${LIMIT} left of ${LIMIT}. Granted.`);
    expect(screen.getByText("Allowance granted. Waiting for the first payment.")).toBeInTheDocument();
  });

  it("shows all of it left from the first frame, rather than counting up to it", () => {
    draw(<WelcomeExample unit="USDC" />);
    expect(gauge()).toHaveTextContent(`${demoFigure(DEMO_LIMIT)}USDC left`);
  });

  it("then spends: each payment arrives as a line, newest first, and what is left goes down", () => {
    draw(<WelcomeExample unit="USDC" />);
    step();
    const [first, second] = DEMO_EVENTS;
    expect(screen.getByText("Spending now")).toBeInTheDocument();
    expect(screen.getByText(first!.what)).toBeInTheDocument();
    expect(screen.getByText(`−${demoFigure(first!.amount)}`)).toBeInTheDocument();
    step();
    const lines = screen.getAllByText(new RegExp(`^(${first!.what}|${second!.what})$`));
    expect(lines.map((line) => line.textContent)).toEqual([second!.what, first!.what]);
    const left = demoFigure(demoFrame(2, 2).left);
    expect(gauge()).toHaveAttribute("aria-label", `An example. ${left} USDC left of ${LIMIT}. Spending now.`);
  });

  it("ends on the payment that is more than is left being refused, with nothing taken for it", () => {
    draw(<WelcomeExample unit="USDC" />);
    step(DEMO_EVENTS.length);
    expect(screen.getByText("Payment refused")).toBeInTheDocument();
    expect(screen.getByText(`Refused: ${refused.what}, ${REFUSED_BECAUSE}`)).toBeInTheDocument();
    expect(screen.getByText(demoFigure(refused.amount))).toBeInTheDocument();
    const left = demoFigure(demoFrame(DEMO_EVENTS.length, 2).left);
    expect(gauge()).toHaveAttribute("aria-label", `An example. ${left} USDC left of ${LIMIT}. Payment refused.`);
  });

  it("and starts again", () => {
    draw(<WelcomeExample unit="USDC" />);
    step(DEMO_STEPS);
    expect(screen.getByText("Granted")).toBeInTheDocument();
  });

  it("with less motion asked for, rests on one frame part-way through, and stays there", () => {
    askForLessMotion(true);
    draw(<WelcomeExample unit="USDC" />);
    const still = demoFrame(DEMO_STILL_STEP, 2);
    const label = `An example. ${demoFigure(still.left)} USDC left of ${LIMIT}. Spending now.`;
    expect(gauge()).toHaveAttribute("aria-label", label);
    step(3);
    expect(gauge()).toHaveAttribute("aria-label", label);
  });

  it("shows two payment lines where there is room, one in a short window, and none in a tiny one", () => {
    draw(<WelcomeExample unit="USDC" />);
    step(3);
    const lines = () => DEMO_EVENTS.filter((event) => screen.queryByText(event.what) !== null).length;
    expect(lines()).toBe(2);
    windowOf(tokens.size.shortWindow - 1);
    expect(lines()).toBe(1);
    windowOf(tokens.size.tinyWindow - 1);
    expect(lines()).toBe(0);
    expect(gauge()).toBeInTheDocument();
  });

  it("names the coin it is given", () => {
    draw(<WelcomeExample unit="MON" />);
    expect(screen.getByText(`${demoFigure(DEMO_LIMIT)} MON limit`)).toBeInTheDocument();
  });
});
