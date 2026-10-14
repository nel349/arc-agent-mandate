import { describe, expect, it } from "vitest";
import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET, type NetworkProfile } from "@kuiralabs/mandate-core";
import { draw } from "../test/draw.tsx";
import { NetworkLogo } from "./NetworkLogo.tsx";

/** The colours each owner's file fills its shapes with, which only the real file carries. */
const ARC_NAVY = "#1B3158";
const MONAD_PURPLE = "#6E54FF";

const drawn = (network: NetworkProfile, size = 28) => draw(<NetworkLogo network={network} size={size} />).container;

describe("a network's logo", () => {
  it("is the owner's own drawing, at the size asked", () => {
    const svg = drawn(ARC_TESTNET, 28).querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("width", "28");
    expect(svg).toHaveAttribute("height", "28");
    expect(svg?.innerHTML.toUpperCase()).toContain(ARC_NAVY);
  });

  it("is Arc's for both Arcs, and Monad's for Monad", () => {
    expect(drawn(ARC_MAINNET).querySelector("svg")?.innerHTML.toUpperCase()).toContain(ARC_NAVY);
    expect(drawn(MONAD_TESTNET).querySelector("svg")?.innerHTML.toUpperCase()).toContain(MONAD_PURPLE);
  });

  it("says nothing to a screen reader, since the network's name is beside it", () => {
    const box = drawn(MONAD_TESTNET);
    expect(box.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("is a dot in the network's colour for a network this build has no logo for", () => {
    const unknown: NetworkProfile = { ...ARC_TESTNET, chainId: 1, name: "Somewhere" };
    const box = drawn(unknown, 20);
    expect(box.querySelector("svg")).toBeNull();
    expect(box.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
