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
import { encodeFunctionData, formatEther, formatUnits, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import { loadOrCreateAgent } from "./identity.mjs";
import { findGrantingAccount, NATIVE_PER_ERC20, RAIL, readAllowance, USDC_ERC20_VIEW } from "./chain.mjs";
import { submitSpend } from "./spend.mjs";
import { bundlerConfigured, bundlerSetupInstructions } from "./bundler.mjs";
import { gatewayAccepting, readEscrow, topUpCalls } from "./gateway.mjs";
import { fetchWithPayment } from "./x402.mjs";
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
/** Escrow and the online budget are both ERC-20 scale — six decimals, not eighteen. */
const online = (units) => `$${formatUnits(units, 6)}`;
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

/**
 * What is already in escrow, as one extra line.
 *
 * Not a second budget — escrow is money this allowance has *already* spent, parked where the agent
 * can sign against it. Reporting it as a separate limit would double-count the same dollars, which
 * is precisely the confusion metering everything on one rail exists to remove.
 */
async function escrowLine(allowance) {
  if (allowance.rail !== RAIL.erc20) return [];
  const held = await readEscrow(agent.address);
  if (held === 0n) return [];
  return [`  of which ${online(held)} is already in escrow, spendable on the web without a top-up`];
}

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
        // Reported separately because the chain meters it separately: the online budget does not
        // come out of the limit above, and the two together are what this agent may spend.
        ...(await escrowLine(allowance)),
      ].join("\n"),
    );
  },
);

const erc20Abi = parseAbi(["function transfer(address to, uint256 value) returns (bool)"]);

/**
 * The one call that pays somebody, on whichever rail the mandate's meter watches.
 *
 * An unscoped mandate meters the ERC-20 view and leaves the native limit at zero, so a payment
 * sent as native value is not merely unmetered — it is refused outright. A scoped one is the other
 * way round. Sending on the wrong rail therefore fails loudly rather than quietly, which is the
 * good case; this exists so it does not happen at all.
 *
 * The money arrives the same either way. Arc's two views are one balance, so a recipient paid
 * through the ERC-20 view sees their *native* balance rise by the same amount — verified on chain,
 * not assumed.
 */
function paymentCall(to, value, rail) {
  if (rail === RAIL.native) return { call: { to, value, data: "0x" } };

  // The rail is the 6-decimal view, so anything finer cannot be sent. Truncating would pay less
  // than asked and report success, which is the one outcome worse than refusing.
  if (value % NATIVE_PER_ERC20 !== 0n) {
    return {
      problem:
        `Nothing was sent. ${formatEther(value)} USDC is finer than this allowance can pay — it ` +
        `settles in millionths of a dollar. Round the amount and try again.`,
    };
  }
  return {
    call: {
      to: USDC_ERC20_VIEW,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi, functionName: "transfer", args: [to, value / NATIVE_PER_ERC20],
      }),
    },
  };
}

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

    const call = paymentCall(to, value, allowance.rail);
    if (call.problem) return text(call.problem);
    const result = await submitSpend({ agent, account, calls: [call.call] });
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

/**
 * Moving money from the wallet into the agent's escrow, so it can pay a seller directly.
 *
 * This spends the *same* allowance a direct payment spends — that is the point of metering
 * everything on one rail, and why nobody has to be shown a second number. What escrow buys is not
 * more authority but a different shape of it: money the agent can sign against without a
 * round trip, because Circle's Gateway will only accept a payment from the payer's own key.
 *
 * Returns a sentence rather than a boolean because every way this fails sends the user somewhere
 * different: a scoped allowance means asking for an unscoped one, a spent allowance means raising
 * it, a thin wallet means adding money. Collapsing those into "insufficient funds" is how an agent
 * tells someone to do the wrong thing.
 */
async function fundEscrow({ account, allowance, needed }) {
  if (allowance.rail !== RAIL.erc20) {
    return {
      ok: false,
      reason:
        `This allowance names specific payees, so it is metered on a rail that cannot reach a web ` +
        `seller. Buying online needs an allowance without a payee list — an agent shopping the ` +
        `open web does not know who it will pay. Ask the user to grant one.`,
    };
  }
  const held = await readEscrow(agent.address);
  if (held >= needed) return { ok: true, toppedUp: 0n };

  const shortfall = needed - held;
  // `spendable` already takes the wallet balance and the time window into account, so this is the
  // real ceiling rather than the limit on paper.
  const available = allowance.spendableWei / NATIVE_PER_ERC20;
  if (shortfall > available) {
    const walletIsTheLimit = allowance.walletBalanceWei < allowance.remainingWei;
    return {
      ok: false,
      reason:
        `This needs ${online(shortfall)} more than the agent holds, and only ${online(available)} ` +
        `is available. ` +
        (walletIsTheLimit
          ? `The wallet holds less than the allowance permits, so the user needs to add funds ` +
            `rather than raise the limit.`
          : `That is the allowance's remaining limit — report it and let the user decide; do not ` +
            `retry a smaller amount unless it actually satisfies the task.`),
    };
  }

  const accepting = await gatewayAccepting();
  if (!accepting.ok) return { ok: false, reason: accepting.reason };

  const result = await submitSpend({ agent, account, calls: topUpCalls(agent.address, shortfall) });
  if (result.setup) return { ok: false, reason: result.reason };
  if (!result.ok) return { ok: false, reason: `The top-up was refused: ${result.reason}` };
  return { ok: true, toppedUp: shortfall };
}

server.registerTool(
  "buy",
  {
    title: "Buy something from a web address",
    description:
      "Fetches a URL and pays if it answers 402 Payment Required, using the x402 protocol. Use " +
      "this for paid APIs and paid pages rather than telling the user you cannot access them. " +
      "The user's online budget bounds this and the chain enforces it, so an over-budget purchase " +
      "is refused and costs nothing. Report a refusal; never ask for a bigger budget mid-task.",
    inputSchema: {
      url: z.string().describe("The address to fetch, e.g. https://api.example.com/report"),
      method: z.string().optional().describe("HTTP method, default GET"),
      reason: z.string().optional().describe("What this buys, shown to the user in their feed"),
    },
  },
  async ({ url, method = "GET", reason }) => {
    const { account, allowance } = await requireMandate();
    let toppedUp = 0n;

    const outcome = await fetchWithPayment({
      url,
      method,
      agent,
      ensureFunds: async (needed) => {
        const funded = await fundEscrow({ account, allowance, needed });
        if (funded.ok) toppedUp = funded.toppedUp;
        return funded;
      },
    });

    if (outcome.problem) {
      return text(`Nothing was bought and nothing was spent. ${outcome.problem}`);
    }
    if (!outcome.paid && outcome.response.status !== 402) {
      // Never needed paying — an ordinary page, or an ordinary error.
      const body = await outcome.response.text();
      return text(
        `${outcome.response.status} ${outcome.response.statusText}, no payment required.\n\n` +
          body.slice(0, 4000),
      );
    }
    if (!outcome.paid) {
      const detail = outcome.settlement?.errorReason ?? outcome.settlement?.error;
      return text(
        `The seller refused the payment${detail ? `: ${detail}` : ""}. The agent's escrow was not ` +
          `charged — a payment that is not settled moves nothing.`,
      );
    }

    const body = await outcome.response.text();
    return text(
      [
        `Bought ${online(outcome.amount)} from ${outcome.payTo}${reason ? ` for ${reason}` : ""}.`,
        toppedUp > 0n ? `Moved ${online(toppedUp)} from the wallet into the agent's escrow first.` : null,
        "",
        body.slice(0, 4000),
      ].filter((line) => line !== null).join("\n"),
    );
  },
);

server.registerTool(
  "top_up",
  {
    title: "Move money into the agent's escrow ahead of time",
    description:
      "Pre-funds the agent's online escrow so later purchases do not each need a top-up first. " +
      "Only worth doing before a run of small payments — `buy` tops up on its own when it has to. " +
      "Money in escrow is committed to this agent and can only leave as a payment or a delayed " +
      "withdrawal, so top up what the task needs, not what the budget allows.",
    inputSchema: {
      amount: z.string().describe("Amount in USDC, as a decimal string, e.g. \"0.50\""),
    },
  },
  async ({ amount }) => {
    const { account, allowance } = await requireMandate();
    const wanted = parseUnits(amount, 6);
    if (wanted <= 0n) throw new Error("Amount must be positive.");

    const held = await readEscrow(agent.address);
    const funded = await fundEscrow({ account, allowance, needed: held + wanted });
    if (!funded.ok) return text(`Nothing was moved. ${funded.reason}`);
    return text(
      `Moved ${online(funded.toppedUp)} into the agent's escrow. It now holds ` +
        `${online(await readEscrow(agent.address))}, spendable on the web without further approval.`,
    );
  },
);

await server.connect(new StdioServerTransport());
