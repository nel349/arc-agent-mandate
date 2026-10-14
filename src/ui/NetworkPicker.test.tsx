import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET, NETWORKS } from "@kuiralabs/mandate-core";
import { draw, endAnimations } from "../test/draw.tsx";
import { groupNetworks, moneyOf, NetworkPicker } from "./NetworkPicker.tsx";

describe("the network picker", () => {
  it("shows the network on screen and whether its money is real, and nothing else until tapped", () => {
    draw(<NetworkPicker networks={NETWORKS} selected={ARC_TESTNET} onSelect={vi.fn()} />);
    const pill = screen.getByRole("button", { name: new RegExp(`Network: ${ARC_TESTNET.name}, Test money`) });
    expect(pill).toHaveTextContent(ARC_TESTNET.name);
    expect(pill).toHaveTextContent("Test money");
    expect(pill.querySelector("svg"), "the network's logo, before its name").not.toBeNull();
    expect(screen.queryByText("Testnets")).toBeNull();
  });

  it("opens to mainnet and the testnets in two groups, real money first, with a mark on the current one", async () => {
    draw(<NetworkPicker networks={NETWORKS} selected={MONAD_TESTNET} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Change network/i }));
    const mainnet = screen.getByText("Mainnet");
    const testnets = screen.getByText("Testnets");
    expect(mainnet.compareDocumentPosition(testnets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = screen.getAllByRole("radio");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      `${ARC_MAINNET.name}, Real money`, `${ARC_TESTNET.name}, Test money`, `${MONAD_TESTNET.name}, Test money`,
    ]);
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(screen.getByText(/separate wallets, each opened with its own passkey/)).toBeInTheDocument();
    expect(rows.every((row) => row.querySelector("svg") !== null), "each row starts with its network's logo").toBe(true);
  });

  it("chooses another network, and closes", async () => {
    const onSelect = vi.fn();
    draw(<NetworkPicker networks={NETWORKS} selected={ARC_TESTNET} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Change network/i }));
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(`${ARC_MAINNET.name}, Real money`) }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(ARC_MAINNET);
    endAnimations();
    expect(screen.queryByText("Testnets")).toBeNull();
  });

  it("choosing the network already shown closes without switching", async () => {
    const onSelect = vi.fn();
    draw(<NetworkPicker networks={NETWORKS} selected={ARC_TESTNET} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Change network/i }));
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(`${ARC_TESTNET.name}, Test money`) }));
    expect(onSelect).not.toHaveBeenCalled();
    endAnimations();
    expect(screen.queryByText("Testnets")).toBeNull();
  });

  it("closes when the dimmed screen behind it is tapped, choosing nothing", async () => {
    const onSelect = vi.fn();
    draw(<NetworkPicker networks={NETWORKS} selected={ARC_TESTNET} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Change network/i }));
    await userEvent.click(screen.getByLabelText("Close"));
    expect(onSelect).not.toHaveBeenCalled();
    endAnimations();
    expect(screen.queryByText("Testnets")).toBeNull();
  });

  it("leaves out a group with no networks in it", async () => {
    draw(<NetworkPicker networks={[ARC_TESTNET, MONAD_TESTNET]} selected={ARC_TESTNET} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Change network/i }));
    expect(screen.queryByText("Mainnet")).toBeNull();
    expect(within(screen.getByText("Testnets").parentElement!).getAllByRole("radio")).toHaveLength(2);
  });

  it("names real money as real and test money as test", () => {
    expect(moneyOf(ARC_MAINNET)).toBe("Real money");
    expect(moneyOf(ARC_TESTNET)).toBe("Test money");
    expect(groupNetworks(NETWORKS)).toEqual({ mainnets: [ARC_MAINNET], testnets: [ARC_TESTNET, MONAD_TESTNET] });
  });
});
