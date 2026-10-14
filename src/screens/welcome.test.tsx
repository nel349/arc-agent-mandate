import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARC_MAINNET, ARC_TESTNET } from "@kuiralabs/mandate-core";
import WelcomeScreen from "../../app/welcome.tsx";
import { draw, endAnimations } from "../test/draw.tsx";
import { choiceOf, MAINNET_IS_SEPARATE, NETWORK_CHOICE_KEY } from "../ui/network-choice.ts";
import { SessionProvider } from "../ui/session-context.tsx";

/**
 * The first screen, drawn with the real session, as the web wallet opens it with nothing remembered.
 * Lives outside `app/` because every file there is a route.
 */
async function opened() {
  draw(<SessionProvider><WelcomeScreen /></SessionProvider>);
  return screen.findByRole("button", { name: "Create a wallet" });
}

beforeEach(() => localStorage.clear());

describe("the welcome screen", () => {
  it("offers a new wallet or a passkey, on the network shown, without reaching any network", async () => {
    const fetches = vi.spyOn(globalThis, "fetch");
    await opened();
    expect(screen.getByRole("button", { name: "I already have a passkey" })).toBeEnabled();
    expect(screen.getByRole("button", { name: new RegExp(`Network: ${ARC_TESTNET.name}, Test money`) })).toBeInTheDocument();
    expect(screen.queryByText(MAINNET_IS_SEPARATE)).toBeNull();
    expect(fetches).not.toHaveBeenCalled();
    fetches.mockRestore();
  });

  it("on mainnet, says before anything is tapped that real money is a wallet of its own", async () => {
    localStorage.setItem(NETWORK_CHOICE_KEY, choiceOf(ARC_MAINNET));
    await opened();
    expect(screen.getByRole("button", { name: new RegExp(`Network: ${ARC_MAINNET.name}, Real money`) })).toBeInTheDocument();
    expect(screen.getByText(MAINNET_IS_SEPARATE)).toBeInTheDocument();
  });

  it("can go to mainnet and back from the picker, and says so as it goes", async () => {
    await opened();
    await userEvent.click(screen.getByRole("button", { name: /Change network/ }));
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(`${ARC_MAINNET.name}, Real money`) }));
    endAnimations();
    await waitFor(() => expect(screen.getByText(MAINNET_IS_SEPARATE)).toBeInTheDocument());
    expect(localStorage.getItem(NETWORK_CHOICE_KEY)).toBe(choiceOf(ARC_MAINNET));

    await userEvent.click(screen.getByRole("button", { name: /Change network/ }));
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(`${ARC_TESTNET.name}, Test money`) }));
    endAnimations();
    await waitFor(() => expect(screen.queryByText(MAINNET_IS_SEPARATE)).toBeNull());
    expect(await screen.findByRole("button", { name: "Create a wallet" })).toBeEnabled();
  });
});
