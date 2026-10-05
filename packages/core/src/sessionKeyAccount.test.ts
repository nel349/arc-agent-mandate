import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createPublicClient, decodeFunctionData, getAddress, http, recoverMessageAddress, size, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { entryPoint07Address, getUserOperationHash } from "viem/account-abstraction";
import { ARC_TESTNET, MONAD_TESTNET } from "./networks.ts";
import { nonceKeyOf, sessionKeyExecutionAbi, STUB_SIGNATURE, toSessionKeyAccount } from "./sessionKeyAccount.ts";

/**
 * What the agent's account has to get exactly right, because the plugin checks each of it during
 * validation and refuses the operation, often silently, when any is off: calls wrapped in the plugin's
 * entry point, a signature that recovers to the agent over the EntryPoint's own hash for this chain, and
 * the agent's address as the nonce key. None of it needs a network: the client is never asked anything
 * here, and the chain id is given, as the agent's bundler client gives it.
 */

const wallet: Address = "0x4ddd83e264ef0d3856B5c7e359e4c24466f45892";
const agent = privateKeyToAccount(generatePrivateKey());
// never reached: building the account and signing ask the client nothing when the chain id is given
const client = createPublicClient({ transport: http("http://127.0.0.1:9") });

const anOperation = (overrides: Partial<{ nonce: bigint; callData: `0x${string}` }> = {}) => ({
  sender: wallet,
  nonce: overrides.nonce ?? (nonceKeyOf(agent.address) << 64n),
  callData: overrides.callData ?? ("0x" as const),
  callGasLimit: 500_000n,
  verificationGasLimit: 120_000n,
  preVerificationGas: 1_300_000n,
  maxFeePerGas: 400_000_000_000n,
  maxPriorityFeePerGas: 7_000_000_000n,
  signature: "0x" as const,
});

test("it is the granting wallet, signed for by the agent, never the agent's own address", async () => {
  const account = await toSessionKeyAccount({ address: wallet, agent, client });
  assert.equal(await account.getAddress(), wallet);
  assert.notEqual(wallet.toLowerCase(), agent.address.toLowerCase());
});

test("calls go through the plugin's entry point, naming the agent, with each call's value and data intact", async () => {
  const account = await toSessionKeyAccount({ address: wallet, agent, client });
  const payee = getAddress("0x00000000000000000000000000000000000000aa");
  const contract = getAddress("0x00000000000000000000000000000000000000bb");
  const encoded = await account.encodeCalls([
    { to: payee, value: 4_000_000_000_000_000n },
    { to: contract, data: "0xdeadbeef" },
  ]);
  const { functionName, args } = decodeFunctionData({ abi: sessionKeyExecutionAbi, data: encoded });
  assert.equal(functionName, "executeWithSessionKey");
  const [calls, sessionKey] = args;
  assert.equal(sessionKey, agent.address);
  assert.deepEqual(calls, [
    { target: payee, value: 4_000_000_000_000_000n, data: "0x" },
    { target: contract, value: 0n, data: "0xdeadbeef" },
  ]);
});

test("the signature recovers to the agent over the EntryPoint's hash of the operation, for the chain it is sent on", async () => {
  const account = await toSessionKeyAccount({ address: wallet, agent, client });
  for (const network of [ARC_TESTNET, MONAD_TESTNET]) {
    const operation = anOperation();
    const signature = await account.signUserOperation({ ...operation, chainId: network.chainId });
    const hash = getUserOperationHash({
      chainId: network.chainId, entryPointAddress: entryPoint07Address, entryPointVersion: "0.7", userOperation: operation,
    });
    assert.equal(await recoverMessageAddress({ message: { raw: hash }, signature }), agent.address, network.name);
  }
});

test("a signature made for one chain does not hold on another", async () => {
  const account = await toSessionKeyAccount({ address: wallet, agent, client });
  const operation = anOperation();
  const onArc = await account.signUserOperation({ ...operation, chainId: ARC_TESTNET.chainId });
  const monadHash = getUserOperationHash({
    chainId: MONAD_TESTNET.chainId, entryPointAddress: entryPoint07Address, entryPointVersion: "0.7", userOperation: operation,
  });
  assert.notEqual(await recoverMessageAddress({ message: { raw: monadHash }, signature: onArc }), agent.address);
});

test("the nonce key is the agent's address, which fits the EntryPoint's 192-bit key", () => {
  assert.equal(nonceKeyOf(agent.address), BigInt(agent.address));
  assert.ok(nonceKeyOf(agent.address) < 2n ** 192n);
  // two agents of one wallet never share a sequence of nonces
  assert.notEqual(nonceKeyOf(agent.address), nonceKeyOf(privateKeyToAccount(generatePrivateKey()).address));
});

test("it never deploys anything, asked on a real chain about a wallet that has no code there", async () => {
  // a plain local chain, nothing forked: viem asks it whether the wallet exists before asking us how to make it
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const anvil = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  try {
    const chain = createPublicClient({ transport: http(`http://127.0.0.1:${port}`) });
    for (let tries = 0; ; tries++) {
      try { await chain.getChainId(); break; } catch (cause) { if (tries > 50) throw cause; await new Promise((done) => setTimeout(done, 100)); }
    }
    const account = await toSessionKeyAccount({ address: wallet, agent, client: chain });
    assert.equal(await chain.getCode({ address: wallet }), undefined);
    assert.deepEqual(await account.getFactoryArgs(), { factory: undefined, factoryData: undefined });
  } finally {
    anvil.kill();
  }
});

test("a session key signs operations and nothing else", async () => {
  const account = await toSessionKeyAccount({ address: wallet, agent, client });
  await assert.rejects(account.signMessage({ message: "anything" }), /signs operations/);
  await assert.rejects(
    account.signTypedData({ domain: {}, types: { A: [{ name: "a", type: "string" }] }, primaryType: "A", message: { a: "x" } }),
    /signs operations/,
  );
});

test("the stub signature is a signature's length, so validation can be priced before the real one is made", async () => {
  const account = await toSessionKeyAccount({ address: wallet, agent, client });
  assert.equal(size(STUB_SIGNATURE), 65);
  assert.equal(await account.getStubSignature(), STUB_SIGNATURE);
});
