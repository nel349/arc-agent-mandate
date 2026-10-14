import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET } from "@kuiralabs/mandate-core";
import { choiceOf, NETWORK_CHOICE_KEY } from "./network-choice.ts";
import { useArcAccount } from "./useArcAccount.ts";
import { serializeWalletMemory, signedOutKeyOf, walletMemoryKeyOf, type WalletMemory } from "./wallet-memory.ts";

/**
 * The wallet's choices about which wallet to open, drawn in a browser page as the web wallet runs.
 *
 * Nothing here reaches Circle or a chain: every case is one where the right answer is to open
 * nothing, and `fetch` is watched (not replaced) to prove it. Opening a wallet for real needs a
 * passkey and Circle, which is the phone's job, not a unit test's.
 */

/** A test wallet, as the phone would have remembered it. Public values only. */
const TEST_WALLET: WalletMemory = {
  credentialId: "kJ3x_Zq-9fA",
  publicKey: `0x02${"ab".repeat(32)}`,
  address: "0xEe1933BbBC8acd7B32caD469D4f22Ca5B19d7918",
};

/** The preference store keeps each value as AsyncStorage does on the web, in `localStorage`. */
const remember = (key: string, value: string): void => localStorage.setItem(key, value);

let fetches: MockInstance<typeof fetch>;
beforeEach(() => {
  localStorage.clear();
  fetches = vi.spyOn(globalThis, "fetch");
});
afterEach(() => fetches.mockRestore());

async function launched() {
  const hook = renderHook(() => useArcAccount());
  await waitFor(() => expect(hook.result.current.restoring).toBe(false));
  return hook;
}

describe("which wallet the app opens", () => {
  it("with nothing remembered, opens on Arc testnet and waits at the welcome screen", async () => {
    const { result } = await launched();
    expect(result.current.account).toBeNull();
    expect(result.current.network).toBe(ARC_TESTNET);
    expect(result.current.error).toBeNull();
    expect(fetches).not.toHaveBeenCalled();
  });

  it("comes back on mainnet when mainnet was shown last", async () => {
    remember(NETWORK_CHOICE_KEY, choiceOf(ARC_MAINNET));
    const { result } = await launched();
    expect(result.current.network).toBe(ARC_MAINNET);
    expect(result.current.account).toBeNull();
  });

  it("never offers the test wallet's passkey to mainnet: a remembered test wallet is not opened there", async () => {
    remember(walletMemoryKeyOf("test"), serializeWalletMemory(TEST_WALLET));
    remember(NETWORK_CHOICE_KEY, choiceOf(ARC_MAINNET));
    const { result } = await launched();
    expect(result.current.account).toBeNull();
    expect(result.current.error).toBeNull();
    expect(fetches).not.toHaveBeenCalled();
    // And the test wallet is still remembered, for when the person goes back to test money.
    expect(localStorage.getItem(walletMemoryKeyOf("test"))).toBe(serializeWalletMemory(TEST_WALLET));
  });

  it("signing out of one kind of money does not count as signing out of the other", async () => {
    remember(signedOutKeyOf("test"), "1");
    remember(NETWORK_CHOICE_KEY, choiceOf(ARC_MAINNET));
    const { result } = await launched();
    expect(result.current.network).toBe(ARC_MAINNET);
    expect(localStorage.getItem(signedOutKeyOf("live"))).toBeNull();
  });
});

describe("a link that names a network", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("opens on that network over the one this phone showed last, and remembers it", async () => {
    remember(NETWORK_CHOICE_KEY, choiceOf(ARC_TESTNET));
    window.history.replaceState(null, "", "/?network=arc");
    const { result } = await launched();
    expect(result.current.network).toBe(ARC_MAINNET);
    expect(localStorage.getItem(NETWORK_CHOICE_KEY)).toBe(choiceOf(ARC_MAINNET));
  });

  it("from the mainnet gym never opens the remembered test wallet", async () => {
    remember(walletMemoryKeyOf("test"), serializeWalletMemory(TEST_WALLET));
    window.history.replaceState(null, "", "/connect?network=arc&return=x");
    const { result } = await launched();
    expect(result.current.network).toBe(ARC_MAINNET);
    expect(result.current.account).toBeNull();
    expect(fetches).not.toHaveBeenCalled();
  });
});

describe("choosing a network with no wallet open", () => {
  it("is only where the next wallet opens, and is remembered", async () => {
    const { result } = await launched();
    act(() => result.current.switchNetwork(MONAD_TESTNET));
    expect(result.current.network).toBe(MONAD_TESTNET);
    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(localStorage.getItem(NETWORK_CHOICE_KEY)).toBe(choiceOf(MONAD_TESTNET));
    expect(fetches).not.toHaveBeenCalled();
  });

  it("to mainnet with no mainnet wallet remembered, opens nothing and leaves Create and Sign in to the person", async () => {
    const { result } = await launched();
    act(() => result.current.switchNetwork(ARC_MAINNET));
    expect(result.current.network).toBe(ARC_MAINNET);
    // "Opening your wallet" while the remembered one is looked for, then the welcome screen's choice.
    expect(result.current.restoring).toBe(true);
    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(localStorage.getItem(NETWORK_CHOICE_KEY)).toBe(choiceOf(ARC_MAINNET));
    expect(result.current.account).toBeNull();
    expect(fetches).not.toHaveBeenCalled();
  });

  it("choosing the network already shown changes nothing", async () => {
    const { result } = await launched();
    act(() => result.current.switchNetwork(ARC_TESTNET));
    expect(result.current.network).toBe(ARC_TESTNET);
    expect(localStorage.getItem(NETWORK_CHOICE_KEY)).toBeNull();
  });
});
