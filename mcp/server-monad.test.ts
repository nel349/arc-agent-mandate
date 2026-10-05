import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readPairingLink } from "@kuiralabs/mandate-core";

/**
 * The connector started for Monad, the way an MCP client starts it, and asked what an agent would see:
 * the tools it offers, what they say, and how it briefs the agent. Pointed at a port nothing listens on,
 * with its key and memory in a scratch folder, so nothing here reaches a chain.
 */

async function connectOnMonad(): Promise<Client> {
  const scratch = mkdtempSync(join(tmpdir(), "arc-mandate-monad-server-"));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  const client = new Client({ name: "monad-test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [
      "--conditions=mandate-source", "--experimental-transform-types", "--disable-warning=ExperimentalWarning",
      join(dirname(fileURLToPath(import.meta.url)), "server.ts"),
    ],
    env: {
      ...env,
      ARC_MANDATE_NETWORK: "monadTestnet",
      ARC_MANDATE_RPC_URL: "http://127.0.0.1:9",
      ARC_MANDATE_KEY_PATH: join(scratch, "agent.key"),
      ARC_MANDATE_ACCOUNT_PATH: join(scratch, "accounts.json"),
    },
    stderr: "ignore",
  }));
  return client;
}

test("on Monad the agent is offered paying and its allowance, and no buying, since Monad has no Gateway here", async () => {
  const client = await connectOnMonad();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["call", "check_allowance", "get_pairing_address", "pay"]);
    const pay = tools.find((tool) => tool.name === "pay");
    assert.match(pay?.description ?? "", /^Sends MON on Monad testnet/);
    assert.doesNotMatch(JSON.stringify(pay), /USDC/);
  } finally {
    await client.close();
  }
});

test("on Monad the agent is briefed that its user adds test MON, with the rest of the path unchanged", async () => {
  const client = await connectOnMonad();
  try {
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /1\. Get the app, and add test MON \(their phone\)/);
    assert.match(instructions, /3\. Scan to grant \(their phone\)/);
    assert.doesNotMatch(instructions, /test USDC/);
  } finally {
    await client.close();
  }
});

test("on Monad the code to scan names Monad's chain, so a wallet scanning it grants on Monad", async () => {
  const client = await connectOnMonad();
  try {
    const result = await client.callTool({ name: "get_pairing_address", arguments: {} });
    const body = (result.content as { readonly text?: string }[]).map((part) => part.text ?? "").join("\n");
    assert.match(body, /ethereum:0x[0-9a-fA-F]{40}@10143\?pairing=[0-9a-f]{32}/);
  } finally {
    await client.close();
  }
});

/**
 * The app an agent works for decides what to ask the wallet for, through its agent; the connector only
 * prints it, so the wallet can show it as the app's request without knowing any app.
 */
test("what the app asks for is printed into the code, and the wallet reads it back exactly", async () => {
  const client = await connectOnMonad();
  try {
    const payee = "0xc831b6e4414E064F7713A3b6017be4a1Eb9F5E9b";
    const result = await client.callTool({
      name: "get_pairing_address",
      arguments: { app: "A test app", limit: "0.01", days: 7, payees: [payee.toLowerCase()] },
    });
    const body = (result.content as { readonly text?: string }[]).map((part) => part.text ?? "").join("\n");
    const link = /ethereum:\S+/.exec(body)?.[0]?.replace(/[).,]+$/, "");
    assert.ok(link, `no link in ${body.slice(0, 200)}`);
    assert.deepEqual(readPairingLink(link)?.request, { app: "A test app", limit: "0.01", days: 7, payees: [payee], calls: [] });
    assert.match(body, /It fills in what was asked for; check it, change anything/);
  } finally {
    await client.close();
  }
});

test("a request that could not be read back is refused, and no code is printed for it", async () => {
  const client = await connectOnMonad();
  try {
    const result = await client.callTool({ name: "get_pairing_address", arguments: { limit: "free" } });
    const body = (result.content as { readonly text?: string }[]).map((part) => part.text ?? "").join("\n");
    assert.match(body, /The code was not made: A limit is a decimal above zero/);
    assert.doesNotMatch(body, /ethereum:/);
  } finally {
    await client.close();
  }
});

/** Found paying on Monad testnet, 5 Oct: both went out, or said the wrong thing, before these. */
test("a payment finer than MON counts, or to the zero address, is refused before anything is sent, saying why", async () => {
  const client = await connectOnMonad();
  try {
    const say = async (args: Record<string, string>) => {
      const result = await client.callTool({ name: "pay", arguments: args });
      return (result.content as { readonly text?: string }[]).map((part) => part.text ?? "").join("\n");
    };
    const payee = "0x9C1a07dCf5B8c1Da6025d84754Bb3a7d3345f281";
    assert.match(await say({ to: payee, amount: "0.0000000000000000001" }), /^Nothing was sent\. MON counts to 18 decimal places, and "0\.0000000000000000001" has 19\.$/);
    assert.match(await say({ to: "0x0000000000000000000000000000000000000000", amount: "0.001" }), /^Nothing was sent\. The zero address belongs to nobody/);
  } finally {
    await client.close();
  }
});

test("on Monad a code that names no payees says the allowance will pay only who it names", async () => {
  const client = await connectOnMonad();
  try {
    const result = await client.callTool({ name: "get_pairing_address", arguments: {} });
    const body = (result.content as { readonly text?: string }[]).map((part) => part.text ?? "").join("\n");
    assert.match(body, /On Monad testnet an allowance pays only the addresses it names/);
    const named = await client.callTool({ name: "get_pairing_address", arguments: { payees: ["0x9C1a07dCf5B8c1Da6025d84754Bb3a7d3345f281"] } });
    assert.doesNotMatch((named.content as { readonly text?: string }[]).map((part) => part.text ?? "").join("\n"), /pays only the addresses it names/);
  } finally {
    await client.close();
  }
});

/**
 * An app's steps, a seat taken or work approved, are calls to functions its code named. What does not
 * read is refused here in words; what the allowance does not name is refused by the chain.
 */
test("a call that does not read is refused before anything is sent, saying what is wrong", async () => {
  const client = await connectOnMonad();
  try {
    const say = async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: "call", arguments: args });
      return (result.content as { readonly text?: string }[]).map((part) => part.text ?? "").join("\n");
    };
    const contract = "0xc831b6e4414E064F7713A3b6017be4a1Eb9F5E9b";
    assert.match(await say({ contract, function: "takeSeat(uint,uint8,address)", args: ["1", "2", contract] }), /^Nothing was sent\. "takeSeat\(uint,uint8,address\)" is not a function written exactly/);
    assert.match(await say({ contract, function: "takeSeat(uint256,uint8,address)", args: ["1", "2"] }), /^Nothing was sent\. takeSeat takes 3 arguments; 2 were given/);
    assert.match(await say({ contract, function: "takeSeat(uint256,uint8,address)", args: ["1", "2", contract], value: "0.0000000000000000001" }), /MON counts to 18 decimal places/);
  } finally {
    await client.close();
  }
});
