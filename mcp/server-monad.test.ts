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
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["check_allowance", "get_pairing_address", "pay"]);
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
    assert.deepEqual(readPairingLink(link)?.request, { app: "A test app", limit: "0.01", days: 7, payees: [payee] });
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
