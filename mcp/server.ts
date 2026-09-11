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
import { encodeFunctionData, formatEther, formatUnits, isAddress, parseAbi, parseEther, parseUnits, type Address } from "viem";
import { loadOrCreateAgent } from "./identity.ts";
import { findGrantingAccount, NATIVE_PER_ERC20, RAIL, readAllowance, rememberedGranter, USDC_ERC20_VIEW, type Allowance } from "./chain.ts";
import { submitSpend } from "./spend.ts";
import { bundlerConfigured, bundlerSetupInstructions } from "./bundler.ts";
import { escrowLedger, gatewayAccepting, readEscrow, topUpCalls, type Call } from "./gateway.ts";
import { fetchWithPayment, type Funding } from "./x402.ts";
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
function pairingCode(address: Address): Promise<string> {
  return new Promise<string>((resolve) => {
    qrcode.generate(address, { small: true }, (code) =>
      resolve(code.split("\n").map((line) => `  ${line}`).join("\n")),
    );
  });
}

/**
 * What the agent is told the moment it connects, before it has done anything.
 *
 * Without it the agent learned the person's path one refusal at a time: it found out there was no
 * allowance by being refused a payment, and the person found out what to do next from whatever the
 * agent made of the refusal. Briefed up front, the agent can say the next step before it is needed.
 *
 * The five steps are the ones the maze page draws and the phone app follows, in the same words
 * (`agent-mandate/JOURNEY.md` in the planning repository keeps them in step). This program cannot
 * import the page's list, so if a title changes there it changes here.
 */
const INSTRUCTIONS = [
  "This connector lets you spend from your user's wallet, inside an allowance they grant from the " +
    "Agent Mandate app on their phone. The chain enforces the limit; you cannot exceed it.",
  "",
  "The path, in five steps, the same words the app and the maze page use:",
  "1. Get the app, and add test USDC (their phone).",
  "2. Connect your agent (their laptop). You are connected, so this one is done.",
  "3. Scan to grant (their phone): New allowance, then Scan the agent's code.",
  "4. Tell your agent to play (their laptop): they give you the task.",
  "5. Watch it spend, revoke any time (their phone).",
  "",
  "Before any paid call, call check_allowance. If there is no allowance, call get_pairing_address, " +
    "show the user its code once, and wait for them to say it is done; then check once. Do not " +
    "show the code again unless they ask.",
  "When a payment is refused, tell the user the one next action the refusal names, and who does it.",
  "When a task is finished, say what it cost, and that the allowance stays until its end date and " +
    "can be revoked in the app.",
].join("\n");

const server = new McpServer({ name: "arc-mandate", version: "0.1.0" }, { instructions: INSTRUCTIONS });

const usd = (wei: bigint): string => `$${formatEther(wei)}`;
/** Escrow and the online budget are both ERC-20 scale — six decimals, not eighteen. */
const online = (units: bigint): string => `$${formatUnits(units, 6)}`;
const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

/**
 * Every spending tool needs the same two facts, and neither is configured.
 *
 * The two ways of having no mandate are one condition in the code and two different situations for
 * whoever is reading. An agent that was never paired needs setting up. An agent whose allowance was
 * *taken away* needs no instructions at all — somebody has just decided this, on purpose, and
 * telling them to go and grant one reads as though the revoke did not register.
 */
/**
 * A person should never be handed a stack trace.
 *
 * Arc's public endpoint rate-limits, and when it did, every tool in here answered with viem's full
 * dump: the calldata, the ABI signature, a link to the docs. That is a reasonable thing to log and
 * a terrible thing to say to somebody who asked whether their agent could buy something.
 */
function unreachable(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return /rate limit|429|too many requests/i.test(text)
    ? "Arc's public endpoint is rate-limiting us. It clears on its own; try again shortly."
    : "Arc's endpoint did not answer.";
}

async function requireMandate() {
  let account: Awaited<ReturnType<typeof findGrantingAccount>>;
  try {
    account = await findGrantingAccount(agent.address, { keyIsNew: created });
  } catch (cause) {
    // What is remembered still says something true, and is worth more than the failure.
    const granter = rememberedGranter(agent.address);
    throw new Error(
      `${unreachable(cause)} Nothing was bought and nothing was charged.` +
      (granter
        ? `\n\nThe last thing known on chain is that ${granter} granted this agent and has since ` +
          `revoked it.`
        : ""),
    );
  }
  if (!account) {
    const granter = rememberedGranter(agent.address);
    throw new Error(
      granter
        ? `The allowance was withdrawn.\n\n${granter} granted this agent and has since revoked ` +
          `it on chain, so the wallet is closed to it and this connector will not spend. Nothing ` +
          `was bought and nothing was charged. If the user wants this agent to carry on, they grant ` +
          `it again in the app with New allowance; until then there is nothing to retry.`
        : `No allowance yet.\n\nStep 3 of 5, on the user's phone: in the Agent Mandate app, tap ` +
          `New allowance, then Scan the agent's code, set a limit and how long, and confirm with ` +
          `Face ID. The code is this agent's address; get_pairing_address shows it as a QR:\n\n` +
          `    ${agent.address}\n\nWait for the user to say it is done, then check once.`,
    );
  }
  try {
    return { account, allowance: await readAllowance(account, agent.address) };
  } catch (cause) {
    throw new Error(`${unreachable(cause)} Nothing was bought and nothing was charged.`);
  }
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
        `Step 3 of 5, on your phone: open the Agent Mandate app, tap New allowance, then Scan the ` +
        `agent's code and point the camera at this one (or paste the address). Set a limit and how ` +
        `long it lasts, and confirm with Face ID. Tell me when it is done.` +
        `${created ? "\n\n(A new key was generated for this agent.)" : ""}`,
    );
  },
);

/**
 * One ledger for the process: this connector is the only thing that spends this escrow, so what it
 * has claimed is exactly what the chain has not caught up with yet.
 */
const escrow = escrowLedger();

/**
 * The only way this file is allowed to ask what is in escrow.
 *
 * The chain's own figure is an overstatement for about a quarter of an hour after every payment,
 * because a claim is committed long before the balance moves. Funding knew that; reporting did not,
 * and told the user $0.063 was spendable when $0.039 was — measured, not imagined. A single reader
 * is what keeps the two from drifting apart again, and `mcp/server.test.ts` fails if a second one
 * appears.
 */
async function spendableEscrow(): Promise<bigint> {
  return escrow.spendable(await readEscrow(agent.address));
}

/**
 * What is already in escrow, as one extra line.
 *
 * Not a second budget — escrow is money this allowance has *already* spent, parked where the agent
 * can sign against it. Reporting it as a separate limit would double-count the same dollars, which
 * is precisely the confusion metering everything on one rail exists to remove.
 */
async function escrowLine(allowance: Allowance): Promise<string[]> {
  if (allowance.rail !== RAIL.erc20) return [];
  const held = await spendableEscrow();
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
type Payment = { readonly call: Call } | { readonly problem: string };

function paymentCall(to: Address, value: bigint, rail: Allowance["rail"]): Payment {
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
          `a new one in the app with New allowance. The amount is not the problem; the window closed.`,
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

    const payment = paymentCall(to, value, allowance.rail);
    if ("problem" in payment) return text(payment.problem);
    const result = await submitSpend({ agent, account, calls: [payment.call] });
    if (!result.ok) {
      // Not a refusal — nothing is wrong with the payment, the connector simply has not been
      // given a way to submit it. Relay this to the user as instructions, not as an error.
      if ("setup" in result) {
        return text(`Nothing was spent — this connector cannot submit payments yet.\n\n${result.reason}`);
      }
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
interface EscrowRequest {
  readonly account: Address;
  readonly allowance: Allowance;
  /** ERC-20 scale, because escrow is. */
  readonly needed: bigint;
}

async function fundEscrow({ account, allowance, needed }: EscrowRequest): Promise<Funding> {
  if (allowance.rail !== RAIL.erc20) {
    return {
      ok: false,
      reason:
        `This allowance names specific payees, so it is metered on a rail that cannot reach a web ` +
        `seller. Buying online needs an allowance without a payee list — an agent shopping the ` +
        `open web does not know who it will pay. Ask the user to grant one.`,
    };
  }
  // Not the chain's figure: what Circle will actually accept, which is less by whatever we have
  // already claimed into a batch that has not landed.
  const held = await spendableEscrow();
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
  if (!result.ok) {
    if ("setup" in result) return { ok: false, reason: result.reason };
    return { ok: false, reason: `The top-up was refused: ${result.reason}` };
  }
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
      ensureFunds: async (needed: bigint): Promise<Funding> => {
        const funded = await fundEscrow({ account, allowance, needed });
        if (funded.ok) toppedUp = funded.toppedUp;
        return funded;
      },
    });

    if (!outcome.paid) {
      if (outcome.problem !== undefined) {
        return text(`Nothing was bought and nothing was spent. ${outcome.problem}`);
      }
      if (outcome.response.status !== 402) {
        // Never needed paying — an ordinary page, or an ordinary error.
        const body = await outcome.response.text();
        return text(
          `${outcome.response.status} ${outcome.response.statusText}, no payment required.\n\n` +
            body.slice(0, 4000),
        );
      }
      const detail = outcome.settlement?.errorReason ?? outcome.settlement?.error;
      return text(
        `The seller refused the payment${detail ? `: ${detail}` : ""}. The agent's escrow was not ` +
          `charged — a payment that is not settled moves nothing.`,
      );
    }

    // Accepted into a batch. The chain will not show it for about a quarter of an hour, so the
    // ledger carries it until then — otherwise the next purchase reads escrow that is already spent.
    escrow.claimed(outcome.amount);

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

    // Added to what is *spendable*, not to what the chain shows. Against the chain's figure this
    // asks for whatever has not settled all over again, and escrow only leaves as a payment or a
    // delayed withdrawal — so the overshoot is money locked up for no reason.
    const held = await spendableEscrow();
    const funded = await fundEscrow({ account, allowance, needed: held + wanted });
    if (!funded.ok) return text(`Nothing was moved. ${funded.reason}`);
    return text(
      `Moved ${online(funded.toppedUp)} into the agent's escrow. It now holds ` +
        `${online(await spendableEscrow())}, spendable on the web without further approval.`,
    );
  },
);

await server.connect(new StdioServerTransport());
