import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { connectArcAccount, reopenArcAccount, WebAuthnMode, type ArcAccount } from "../arc/account.ts";
import { balanceOf } from "../arc/send.ts";
import { Amount } from "../arc/amount.ts";
import { ARC_TESTNET, CIRCLE_SHARED_MAINNET, type NetworkProfile } from "@kuiralabs/mandate-core";
import { canOfferExistingPasskey } from "../passkey/shim.ts";
import { walletFailure } from "./failure.ts";
import { anotherAddressOn, reopenOrder } from "./network-choice.ts";
import { loadNetworkChoice, saveNetworkChoice } from "./network-choice-store.ts";
import { isSameWallet, launchPlan, sameWalletKind, walletKindOf, walletMemoryOf, type WalletMemory } from "./wallet-memory.ts";
import {
  clearWalletMemory, loadWalletMemory, rememberSignedOut, saveWalletMemory, wasSignedOutOnPurpose,
} from "./wallet-memory-store.ts";

/**
 * The wallet: creating one, returning to one, and what it holds.
 *
 * Pulled out of the W1 harness so the product screen and the harness share one account rather
 * than each opening their own — two passkey ceremonies for one wallet would be a confusing thing
 * to put in front of a person.
 */

export const CIRCLE_CONFIG = {
  clientKey: process.env.EXPO_PUBLIC_CIRCLE_CLIENT_KEY ?? "",
  clientUrl: process.env.EXPO_PUBLIC_CIRCLE_CLIENT_URL ?? "",
  passkeyDomain: process.env.EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN ?? "",
} as const;

/**
 * The Circle settings a wallet opens with on a network: the test key from this build's settings on a
 * test network, and on a live one the LIVE key the core shares, which Circle requires there and which
 * the connector uses too, so the wallet and its agents are sponsored by the one capped policy.
 */
export const circleConfigFor = (network: NetworkProfile): typeof CIRCLE_CONFIG =>
  network.live
    ? { clientKey: CIRCLE_SHARED_MAINNET.clientKey, clientUrl: CIRCLE_SHARED_MAINNET.clientUrl, passkeyDomain: CIRCLE_SHARED_MAINNET.passkeyDomain }
    : CIRCLE_CONFIG;

/** Arc settles in under a second, so ten is unhurried. Matches the mandate poll deliberately. */
const BALANCE_POLL_MS = 10_000;

export interface ArcWallet {
  readonly account: ArcAccount | null;
  /**
   * The network on screen: the open wallet's, or the one the next wallet opens on. Arc until the
   * person chooses another, and then whichever they chose last.
   */
  readonly network: NetworkProfile;
  readonly balance: Amount | null;
  readonly busy: boolean;
  /**
   * True from launch until the remembered wallet has reopened, or it is clear there is none.
   *
   * Without it the welcome screen flashed past somebody who was already signed in, and a tap on
   * "Create a wallet" in that moment would have made them a second one.
   */
  readonly restoring: boolean;
  readonly error: string | null;
  /** Mints a NEW passkey, and therefore a new wallet. */
  create(): void;
  /**
   * Returns to a wallet whose passkey is already on the device.
   *
   * The wallet is derived from the credential rather than from anything stored here, so it is
   * never lost while the passkey is in the keychain. Passing no credential id lets the OS show
   * every passkey for this relying party and let the person choose.
   */
  signIn(): void;
  /**
   * Puts the wallet down, back to the welcome screen.
   *
   * Nothing is lost: the wallet is derived from its passkey, so signing in again, with this passkey
   * or another, returns to it. Ignored while a passkey ceremony is in flight, which would otherwise
   * land a wallet after the person had left it.
   */
  signOut(): void;
  /**
   * Shows another network. Among the test networks it is the same wallet: the same passkey reopened
   * there, with no ceremony, since it is the same address on each; if it ever opened another address,
   * the wallet stays where it was and says so.
   *
   * Real money is another wallet with another passkey, because Circle will not let one passkey hold
   * both. So switching between test money and real money puts the open wallet down, without signing
   * out of it, and opens the one remembered for the other kind. With none remembered, the welcome
   * screen offers to create one or to open it with its passkey, on the network chosen.
   */
  switchNetwork(next: NetworkProfile): void;
  refresh(): void;
}

export function useArcAccount(): ArcWallet {
  const [account, setAccount] = useState<ArcAccount | null>(null);
  const [chosen, setChosen] = useState<NetworkProfile>(ARC_TESTNET);
  const network = account?.network ?? chosen;
  /** The network now, for a failure that lands after the render that started the work. */
  const networkRef = useRef(network);
  networkRef.current = network;
  const [balance, setBalance] = useState<Amount | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((work: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        await work();
      } catch (cause) {
        // One describer, shared with the mandate screen, and one rule for the wallet's paths: a
        // closed passkey sheet says nothing, so the welcome screen stays as the person left it.
        setError(walletFailure(cause, networkRef.current));
      } finally {
        setBusy(false);
      }
    })();
  }, [busy]);

  const load = useCallback(async (next: ArcAccount) => {
    setAccount(next);
    setChosen(next.network);
    setBalance(await balanceOf(next.address, next.network));
  }, []);

  /**
   * A wallet the person just opened with their passkey: shown, and remembered for next time.
   *
   * Shown first. Remembering is a convenience, and a phone that refuses it must still let the person
   * in; they are asked for the passkey again at the next launch, which is where they were before.
   */
  const admit = useCallback(async (next: ArcAccount) => {
    await load(next);
    const kind = walletKindOf(next.network);
    await Promise.all([saveWalletMemory(kind, walletMemoryOf(next)), rememberSignedOut(kind, false)])
      .catch((cause: unknown) => console.warn("[wallet] this phone would not remember the wallet", cause));
  }, [load]);

  const create = useCallback(() => run(async () => {
    // The passkey's name is what the browser lists it by, and it lists test and real-money passkeys
    // together, so the real-money one says so.
    const named = chosen.live ? "arc-mainnet" : "arc";
    await admit(await connectArcAccount(
      { ...circleConfigFor(chosen), username: `${named}-${Date.now()}` }, WebAuthnMode.Register, {}, chosen,
    ));
  }), [run, admit, chosen]);

  const signIn = useCallback(() => run(async () => {
    await admit(await connectArcAccount({ ...circleConfigFor(chosen), username: "" }, WebAuthnMode.Login, {}, chosen));
  }), [run, admit, chosen]);

  /**
   * The remembered wallet reopened with no ceremony, on the network chosen or, failing that, on the
   * others `reopenOrder` names. True when it opened. A memory that opens some other wallet everywhere
   * describes nobody's money, so it is forgotten and the person signs in with the passkey.
   */
  const reopenRemembered = useCallback(async (
    chosenNetwork: NetworkProfile,
    memory: WalletMemory,
    /** told each network as it is tried, so a failure can name where it happened */
    trying: (on: NetworkProfile) => void,
  ): Promise<boolean> => {
    const credential = { id: memory.credentialId, publicKey: memory.publicKey };
    for (const on of reopenOrder(chosenNetwork)) {
      trying(on);
      const reopened = await reopenArcAccount(circleConfigFor(on), credential, on);
      if (!isSameWallet(memory, reopened.address)) continue;
      await load(reopened);
      if (on.chainId !== chosenNetwork.chainId) {
        setError(anotherAddressOn(chosenNetwork));
        await saveNetworkChoice(on).catch((cause: unknown) => console.warn("[wallet] this phone would not remember the network", cause));
      }
      return true;
    }
    await clearWalletMemory(walletKindOf(chosenNetwork));
    return false;
  }, [load]);

  const switchNetwork = useCallback((next: NetworkProfile) => {
    if (busy || next.chainId === network.chainId) return;
    const remember = (): void => {
      void saveNetworkChoice(next).catch((cause: unknown) => console.warn("[wallet] this phone would not remember the network", cause));
    };
    // The same kind of money: the same wallet, shown on the other network.
    if (account && sameWalletKind(account.network, next)) {
      run(async () => {
        const reopened = await reopenArcAccount(circleConfigFor(next), account.credential, next);
        if (reopened.address.toLowerCase() !== account.address.toLowerCase()) throw new Error(anotherAddressOn(next));
        setBalance(null);
        await load(reopened);
        remember();
      });
      return;
    }
    // Another kind of money, or no wallet open: whatever is open is put down, not signed out of, and
    // the wallet remembered for this network's kind opens, if there is one. "Opening your wallet" shows
    // meanwhile, so the welcome screen's buttons do not flash past somebody who has a wallet here.
    // Set before the memory is read, not after: read first, the welcome screen's Create flashed for
    // the moment the read took, in front of somebody who may already have a wallet here.
    setRestoring(true);
    setAccount(null);
    setBalance(null);
    setError(null);
    setChosen(next);
    remember();
    void (async () => {
      let opening = next;
      try {
        const memory = await loadWalletMemory(walletKindOf(next));
        if (memory === null) return;
        await reopenRemembered(next, memory, (on) => { opening = on; });
      } catch (cause) {
        // The memory is kept, as at launch, so the next try can still open it; the passkey works now.
        setError(walletFailure(cause, opening));
      } finally {
        setRestoring(false);
      }
    })();
  }, [account, busy, network, run, load, reopenRemembered]);

  const signOut = useCallback(() => {
    if (busy) return;
    const kind = walletKindOf(account?.network ?? chosen);
    setAccount(null);
    setBalance(null);
    setError(null);
    // Forgotten on the phone too, and marked as a choice, so the next launch does not offer the
    // passkey straight back. Only this kind's wallet: the other kind's is a separate wallet.
    void Promise.all([clearWalletMemory(kind), rememberSignedOut(kind, true)])
      .catch((cause: unknown) => console.warn("[wallet] this phone could not forget the wallet", cause));
  }, [account, busy, chosen]);

  /**
   * Reopen the wallet at launch, once.
   *
   * A remembered wallet reopens with no ceremony. With nothing remembered, which after a reinstall
   * is the ordinary case, iOS is asked for its returning-user sheet, which shows only if a passkey
   * for this app is already on the phone. Anything else lands on the welcome screen as before.
   *
   * Guarded by a ref rather than cancelled on cleanup: the provider holding this lives as long as
   * the app, and a development double-mount would otherwise start two passkey requests at once.
   */
  const restoreStarted = useRef(false);
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void (async () => {
      /** Where the wallet is being opened, for a failure to name. */
      let opening: NetworkProfile = ARC_TESTNET;
      try {
        const lastNetwork = await loadNetworkChoice();
        setChosen(lastNetwork);
        opening = lastNetwork;
        // The wallet for the kind of money last shown: test and real money are kept apart.
        const kind = walletKindOf(lastNetwork);
        const [memory, signedOutOnPurpose] = await Promise.all([loadWalletMemory(kind), wasSignedOutOnPurpose(kind)]);
        const plan = launchPlan({ memory, signedOutOnPurpose, canOfferPasskey: canOfferExistingPasskey() });

        if (plan === "reopen" && memory !== null) {
          await reopenRemembered(lastNetwork, memory, (on) => { opening = on; });
        } else if (plan === "offer-passkey") {
          try {
            await admit(await connectArcAccount(
              { ...circleConfigFor(lastNetwork), username: "" }, WebAuthnMode.Login, { returningUser: true }, lastNetwork,
            ));
          } catch (cause) {
            // Two ordinary endings here, and neither is worth a word: the person closed the sheet,
            // or the phone had no passkey to offer. The welcome screen is the answer to both, with
            // nothing to apologise for. Anything else, like Circle not answering after they chose a
            // passkey, is said -- including the very failure iOS reports for an empty phone, which
            // is why `walletFailure` tells them apart by the request and not by the error.
            setError(walletFailure(cause, lastNetwork));
          }
        }
      } catch (cause) {
        // Reopening failed for some other reason, a network most likely. The memory is kept, so the
        // next launch tries again; this one shows the welcome screen, where the passkey still works.
        setError(walletFailure(cause, opening));
      } finally {
        setRestoring(false);
      }
    })();
  }, [admit, reopenRemembered]);

  const refresh = useCallback(() => run(async () => {
    if (!account) throw new Error("no wallet yet");
    setBalance(await balanceOf(account.address, account.network));
  }), [account, run]);

  /**
   * The balance goes stale on its own, because an agent spends from outside this app. Polling
   * lives here rather than in the mandate hook: whoever owns a number is responsible for it being
   * true, and having two hooks read the same figure is how they end up disagreeing on screen.
   */
  useEffect(() => {
    if (!account || busy) return;
    const timer = setInterval(() => {
      void balanceOf(account.address, account.network).then(setBalance).catch(() => {
        // A missed poll is not worth a message; the next one will say the same thing or better.
      });
    }, BALANCE_POLL_MS);
    return () => clearInterval(timer);
  }, [account, busy]);

  /**
   * And again when the app returns, since the timer did not run while it was away.
   *
   * Same reason as the mandate screen's: a suspended interval is not a slow interval, it is a
   * stopped one, so the balance on screen was as old as the last time this app was open.
   */
  useEffect(() => {
    if (!account) return;
    const watch = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void balanceOf(account.address, account.network).then(setBalance).catch(() => {
        // Same as the poll: a missed read is not worth a message.
      });
    });
    return () => watch.remove();
  }, [account]);

  return { account, network, balance, busy, restoring, error, create, signIn, signOut, switchNetwork, refresh };
}
