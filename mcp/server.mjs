#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

/**
 * Read the project's own `.env` before anything else looks at `process.env`.
 *
 * An MCP client launches this server itself and hands it no environment worth having — no working
 * directory, no shell, nothing from a profile. The obvious response is to copy the keys into the
 * client's config, and that is what this used to require: an install with secrets in it, generated
 * per machine because the path had to be absolute.
 *
 * But the server is sitting next to a `.env` that already holds them. Reading it makes installing
 * the connector one command with nothing secret in it, and leaves one place where configuration
 * lives. Real environment variables still win, so a deployment that sets them properly is
 * unaffected.
 */
loadEnv({ path: join(dirname(dirname(fileURLToPath(import.meta.url))), ".env"), quiet: true });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { formatEther, isAddress, parseEther } from "viem";
import { loadOrCreateAgent } from "./identity.mjs";
import { findGrantingAccount, readAllowance } from "./chain.mjs";
import { submitSpend } from "./spend.mjs";
import { bundlerConfigured, bundlerSetupInstructions } from "./bundler.mjs";
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
  const account = await findGrantingAccount(agent.address, { keyIsNew: created });
  if (!account) {
    throw new Error(
      `No allowance yet.\n\nOpen the Agent Mandate app, paste this address into ` +
        `"Give an agent an allowance", set a limit and how long it lasts, and confirm with ` +
        `Face ID:\n\n    ${agent.address}\n\nThen ask me again.`,
    );
  }
  return { account, allowance: await readAllowance(account, agent.address) };
}

server.registerTool(
  "get_pairing_address",
  {
    title: "Show this agent's address",
    description:
      "Returns the address to grant an allowance to, with a QR code the user scans with their " +
      "phone. Call this when they ask how to connect, fund, or authorise this agent. Nothing " +
      "secret is in it — it is a public address.\n\n" +
      "REPRODUCE THE OUTPUT VERBATIM IN YOUR REPLY, inside a fenced code block, including every " +
      "line of the QR code. Do not summarise it, do not describe it, do not replace it with the " +
      "address alone, and do not tell the user to look at the tool output — they frequently " +
      "cannot see it. A QR code that stays in tool output is a QR code nobody can scan, and the " +
      "user is standing there holding a phone.",
    inputSchema: {},
  },
  async () => {
    const account = await findGrantingAccount(agent.address, { keyIsNew: created });
    if (account) {
      // Now that an allowance exists, spending is the next thing they will try — so if the
      // connector cannot reach a bundler, say so here rather than letting the first payment fail.
      return text(
        `This agent is already authorised by ${account}.\nIts address is ${agent.address}.` +
          (bundlerConfigured()
            ? ""
            : `\n\nOne thing left before it can spend.\n\n${bundlerSetupInstructions()}`),
      );
    }
    return text(
      `SHOW EVERYTHING BELOW TO THE USER EXACTLY AS IT IS, in a fenced code block. The QR is for ` +
        `them to scan with a phone camera; it is useless if it stays in your tool output or if its ` +
        `lines are reflowed.\n\n` +
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
      [
        `Allowance from ${account}`,
        `  limit      ${allowance.limit} USDC`,
        `  spent      ${allowance.spent} USDC`,
        `  remaining  ${allowance.remaining} USDC`,
        `  wallet     ${allowance.walletBalance} USDC`,
        "",
        // The number to plan against. Three things bound a payment and the allowance is only one
        // of them, so reporting it alone is how an agent promises a purchase it cannot make.
        `  spendable now: ${allowance.spendable} USDC`,
        ...(allowance.expired
          ? ["", "This allowance has expired, so nothing can be spent until it is granted again."]
          : allowance.notYet
            ? ["", "This allowance has not started yet."]
            : allowance.spendableWei < allowance.remainingWei
              ? ["", "The wallet holds less than the allowance permits, so the wallet is the limit."]
              : []),
        ...(allowance.expiresAt === null
          ? []
          : [`  expires ${new Date(allowance.expiresAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`]),
      ].join("\n"),
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
    if (allowance.expired) {
      return text(
        `Refused before sending: this allowance expired. Nothing was spent. Ask the user to grant ` +
          `a new one from the app — the amount is not the problem, the window closed.`,
      );
    }
    if (value > allowance.spendableWei) {
      // Which bound was hit changes what the user should do about it, so say which.
      const walletIsTheLimit = allowance.walletBalanceWei < allowance.remainingWei;
      return text(
        `Refused before sending: ${usd(value)} exceeds the ${allowance.spendable} USDC available. ` +
          (walletIsTheLimit
            ? `The allowance permits ${allowance.remaining} USDC but the wallet only holds ` +
              `${allowance.walletBalance}, so the wallet is the limit — the user needs to add funds, ` +
              `not raise the allowance.`
            : `That is the allowance's remaining limit. Ask the user to raise it if this purchase ` +
              `is worth it — do not retry a smaller amount unless that actually satisfies the task.`),
      );
    }

    const result = await submitSpend({ agent, account, to, value });
    if (result.setup) {
      // Not a refusal — nothing is wrong with the payment, the connector simply has not been
      // given a way to submit it. Relay this to the user as instructions, not as an error.
      return text(`Nothing was spent — this connector cannot submit payments yet.\n\n${result.reason}`);
    }
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
