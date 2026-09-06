#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { formatEther, isAddress, parseEther } from "viem";
import { loadOrCreateAgent } from "./identity.mjs";
import { findGrantingAccount, readAllowance } from "./chain.mjs";
import { submitSpend } from "./spend.mjs";
import qrcode from "qrcode-terminal";

/**
 * An allowance for your coding agent.
 *
 * Circle's Agent Stack gives an agent its own wallet. This does the opposite and more useful
 * thing: it lets an agent spend from **your** wallet, inside limits you set on your phone and can
 * take back with your face. The agent holds a key that is worth nothing on its own.
 *
 * Works with any MCP client — Claude Code, Cursor, Codex — because the agent framework already
 * exists and the person already runs it. That is the pairing problem solved by not having one.
 */
const { account: agent, created } = loadOrCreateAgent();
/**
 * The address as a scannable code, because the two halves of this are on different devices.
 *
 * The agent runs on a laptop and the wallet lives on a phone, so pairing means moving 42 characters
 * between them — the one genuinely awkward step in the flow, and the first one anybody meets. A
 * code the phone can read turns it into pointing a camera.
 *
 * Rendered small and as text, since it has to survive being printed inside a chat transcript
 * rather than a terminal. The address is printed underneath either way: a code is a convenience,
 * and a person whose camera will not cooperate must never be stuck.
 */
function pairingCode(address) {
  return new Promise((resolve) => {
    qrcode.generate(address, { small: true }, (code) =>
      resolve(code.split("\n").map((line) => `  ${line}`).join("\n")),
    );
  });
}

const server = new McpServer({ name: "arc-mandate", version: "0.1.0" });

const usd = (wei) => `$${formatEther(wei)}`;
const text = (s) => ({ content: [{ type: "text", text: s }] });

/** Every spending tool needs the same two facts, and neither is configured. */
async function requireMandate() {
  const account = await findGrantingAccount(agent.address);
  if (!account) {
    throw new Error(
      `No allowance yet. Open the Agent Mandate app, choose "Add an agent", and grant this ` +
        `address:\n\n    ${agent.address}\n\nThen ask me again.`,
    );
  }
  return { account, allowance: await readAllowance(account, agent.address) };
}

server.registerTool(
  "get_pairing_address",
  {
    title: "Show this agent's address",
    description:
      "Returns the address to grant an allowance to. Show this to the user when they ask how to " +
      "connect, fund, or authorise this agent. Nothing secret is in it — it is a public address.",
    inputSchema: {},
  },
  async () => {
    const account = await findGrantingAccount(agent.address);
    if (account) {
      return text(`This agent is already authorised by ${account}.\nIts address is ${agent.address}.`);
    }
    return text(
      `Grant an allowance to:\n\n${await pairingCode(agent.address)}\n    ${agent.address}\n\n` +
        `Open the Agent Mandate app, scan that code — or paste the address — into ` +
        `"Give an agent an allowance", choose an amount and how long it lasts, and confirm with ` +
        `Face ID.${created ? "\n\n(A new key was generated for this agent.)" : ""}`,
    );
  },
);

server.registerTool(
  "check_allowance",
  {
    title: "Check the remaining allowance",
    description:
      "How much this agent may still spend. Call this before promising a purchase, and after a " +
      "refusal to see whether the limit or the payee was the problem.",
    inputSchema: {},
  },
  async () => {
    const { account, allowance } = await requireMandate();
    return text(
      `Allowance from ${account}\n` +
        `  limit     ${allowance.limit} USDC\n` +
        `  spent     ${allowance.spent} USDC\n` +
        `  remaining ${allowance.remaining} USDC`,
    );
  },
);

server.registerTool(
  "pay",
  {
    title: "Pay for something",
    description:
      "Sends USDC on Arc from the user's wallet, within the allowance they granted. The limit is " +
      "enforced by the chain, not by you: an over-limit or unapproved payment is refused during " +
      "validation and costs nothing. Never ask the user to raise a limit mid-task — report the " +
      "refusal and let them decide.",
    inputSchema: {
      to: z.string().describe("Recipient address (0x…)"),
      amount: z.string().describe("Amount in USDC, as a decimal string, e.g. \"2.50\""),
      reason: z.string().optional().describe("What this buys, shown to the user in their feed"),
    },
  },
  async ({ to, amount, reason }) => {
    if (!isAddress(to)) throw new Error(`Not an address: ${to}`);
    const value = parseEther(amount);
    if (value <= 0n) throw new Error("Amount must be positive.");

    const { account, allowance } = await requireMandate();
    // Checked here purely so the agent gets a sentence it can act on. The chain refuses it either
    // way; this only avoids spending a round trip to be told so.
    if (value > allowance.remainingWei) {
      return text(
        `Refused before sending: ${usd(value)} exceeds the ${allowance.remaining} USDC remaining. ` +
          `Ask the user to raise the limit if this purchase is worth it — do not retry a smaller ` +
          `amount unless that actually satisfies the task.`,
      );
    }

    const result = await submitSpend({ agent, account, to, value });
    if (!result.ok) {
      return text(
        `The chain refused this payment: ${result.reason}\n` +
          `Nothing was spent. Common causes: the payee is not on the allowance's list, the ` +
          `allowance is exhausted, or it was revoked.`,
      );
    }
    return text(
      `Paid ${usd(value)} to ${to}${reason ? ` for ${reason}` : ""}.\n` +
        `Transaction ${result.hash}\n` +
        `Remaining after this: about ${formatEther(allowance.remainingWei - value)} USDC.`,
    );
  },
);

await server.connect(new StdioServerTransport());
