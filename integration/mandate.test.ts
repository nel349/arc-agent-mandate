import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseEther } from "viem";
import { keyIsGone } from "../src/arc/mandate.ts";
import * as arc from "./harness.ts";

/**
 * The baseline: everything the product claims, exercised the way a user's money actually travels
 * -- a signed user operation through the real EntryPoint into the real Circle account.
 *
 * The Solidity suite proves the plugin's rules in isolation. This proves the rules still hold once
 * they are wired to an account, a bundler path and a balance, which is where integrations break.
 */
describe("a mandate, end to end on a forked Arc", () => {
  const MANDATE = parseEther("10");
  let clean: string;

  before(async () => {
    await arc.start({ mandate: MANDATE, walletBalance: parseEther("500") });
    clean = await arc.snapshot();
  });
  after(() => arc.stop());
  beforeEach(async () => {
    await arc.revert(clean);
    clean = await arc.snapshot();
  });

  it("lets the agent spend inside the mandate, with nobody approving", async () => {
    const before = await arc.balance(arc.PAYEE);
    await arc.pay(arc.PAYEE, parseEther("2"));
    assert.equal(await arc.balance(arc.PAYEE) - before, parseEther("2"));
  });

  it("counts spending as a running total, not a per-call cap", async () => {
    for (let i = 0; i < 4; i++) await arc.pay(arc.PAYEE, parseEther("2"));
    assert.equal((await arc.mandateInfo()).limitUsed, parseEther("8"));
    assert.equal(await arc.balance(arc.PAYEE), parseEther("8"));
  });

  it("refuses the payment that would exceed the mandate", async () => {
    for (let i = 0; i < 5; i++) await arc.pay(arc.PAYEE, parseEther("2"));   // exactly 10
    await assert.rejects(() => arc.pay(arc.PAYEE, parseEther("1")), /REFUSED/);
  });

  it("charges nothing for a refusal, because it fails during validation", async () => {
    for (let i = 0; i < 5; i++) await arc.pay(arc.PAYEE, parseEther("2"));
    const wallet = await arc.balance(arc.MSCA);
    const payee = await arc.balance(arc.PAYEE);

    await assert.rejects(() => arc.pay(arc.PAYEE, parseEther("1")), /REFUSED/);

    assert.equal(await arc.balance(arc.MSCA), wallet, "a refused payment must not cost gas");
    assert.equal(await arc.balance(arc.PAYEE), payee);
  });

  it("leaves the rest of the wallet untouchable", async () => {
    for (let i = 0; i < 5; i++) await arc.pay(arc.PAYEE, parseEther("2"));
    const left = await arc.balance(arc.MSCA);
    assert.ok(left > parseEther("489"), `the wallet should still hold ~490, held ${left}`);
    await assert.rejects(() => arc.pay(arc.PAYEE, parseEther("1")), /REFUSED/);
  });

  it("refuses a payee the mandate never named", async () => {
    await assert.rejects(() => arc.pay(arc.STRANGER, parseEther("1")), /REFUSED/);
    assert.equal(await arc.balance(arc.STRANGER), 0n);
  });

  it("closes the ERC-20 rail, so one balance cannot be spent twice", async () => {
    // Arc's USDC is native *and* an ERC-20 view over the same balance. If a session key could
    // reach the view, the mandate would bound one rail while the other stayed open.
    const transfer = encodeFunctionData({
      abi: [{ name: "transfer", type: "function", stateMutability: "nonpayable",
              inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
              outputs: [{ type: "bool" }] }],
      functionName: "transfer", args: [arc.PAYEE, 1_000_000n],
    });
    await assert.rejects(
      () => arc.spend({ calls: [{ target: arc.USDC_ERC20_VIEW, value: 0n, data: transfer }] }),
      /REFUSED/,
    );
  });

  it("refuses a key that was never granted anything", async () => {
    await assert.rejects(
      () => arc.spend({ calls: [{ target: arc.PAYEE, value: parseEther("1"), data: "0x" }],
                        key: arc.OUTSIDER_PK }),
      /REFUSED/,
    );
  });

  describe("revocation", () => {
    it("stops the agent immediately", async () => {
      await arc.pay(arc.PAYEE, parseEther("2"));
      await arc.revokeAgent();
      await assert.rejects(() => arc.pay(arc.PAYEE, parseEther("1")), /REFUSED/);
    });

    it("removes the authority, not the key", async () => {
      await arc.revokeAgent();
      // The agent still holds and can still sign with its key. What it no longer has is standing
      // with the account -- which is the difference between revoking and hoping.
      assert.equal((await arc.sessionKeys()).length, 0);
      const signed = await arc.agent.signMessage({ message: "still holding my key" });
      assert.ok(signed.startsWith("0x"));
    });

    it("leaves nothing behind that could still spend", async () => {
      await arc.pay(arc.PAYEE, parseEther("2"));
      const payee = await arc.balance(arc.PAYEE);
      await arc.revokeAgent();
      for (const amount of ["1", "0.0001"]) {
        await assert.rejects(() => arc.pay(arc.PAYEE, parseEther(amount)), /REFUSED/);
      }
      assert.equal(await arc.balance(arc.PAYEE), payee);
    });

    it("refuses to answer for the key at all, in the way the app reads as gone", async () => {
      await arc.revokeAgent();
      // The phone names the account's keys and then reads each one, which is two calls at two
      // blocks. A revoke landing between them leaves it asking about a key the plugin has just
      // forgotten, and the refusal it gets back must be the one it treats as a gone key -- not as
      // a read that failed, which is what put "Arc is busy" on screen as the revoke succeeded.
      // Checked against the deployed plugin rather than an error written here to match.
      const refusal = await arc.publicClient.readContract({
        address: arc.pluginAddress(), abi: arc.pluginAbi,
        functionName: "getNativeTokenSpendLimitInfo", args: [arc.MSCA, arc.agent.address],
      }).then(() => null, (cause: unknown) => cause);
      assert.ok(refusal !== null, "the plugin answered for a key it no longer holds");
      assert.equal(keyIsGone(refusal), true);
    });
  });

  describe("the owner can re-scope a live mandate", () => {
    it("raising the limit lets a refused payment through", async () => {
      for (let i = 0; i < 5; i++) await arc.pay(arc.PAYEE, parseEther("2"));
      await assert.rejects(() => arc.pay(arc.PAYEE, parseEther("2")), /REFUSED/);

      await arc.permissions([
        encodeFunctionData({ abi: arc.updatesAbi, functionName: "setNativeTokenSpendLimit",
                             args: [parseEther("20"), 0] }),
      ]);
      await arc.pay(arc.PAYEE, parseEther("2"));
      assert.equal(await arc.balance(arc.PAYEE), parseEther("12"));
    });

    it("lowering it below what is already spent stops the agent dead", async () => {
      for (let i = 0; i < 3; i++) await arc.pay(arc.PAYEE, parseEther("2"));
      await arc.permissions([
        encodeFunctionData({ abi: arc.updatesAbi, functionName: "setNativeTokenSpendLimit",
                             args: [parseEther("4"), 0] }),
      ]);
      await assert.rejects(() => arc.pay(arc.PAYEE, parseEther("0.5")), /REFUSED/);
    });
  });
});
