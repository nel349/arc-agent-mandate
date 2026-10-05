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
import { encodeFunctionData, formatEther, formatUnits, getAddress, isAddress, isAddressEqual, parseAbi, parseEther, parseUnits, zeroAddress, type Address } from "viem";
import { loadOrCreateAgent } from "@kuiralabs/mandate-core/node";
import { agentKeyPath } from "./keyPath.ts";
import {
  chain, findGrant, NATIVE_PER_ERC20, pairingToShow, publicClient, RAIL, readAllowance, rememberedEscrow,
  rememberedGranter, rememberedIdentity, rememberEscrow, rememberIdentity, USDC_ERC20_VIEW,
  type Allowance, type Grant,
} from "./chain.ts";
import { setUpIdentity, type IdentityOutcome, type Submit } from "./erc8004.ts";
import { amountIn, NO_REQUEST, pairingLink, payeesRequired, requestFrom, type AgentRequest } from "@kuiralabs/mandate-core";
import { briefingSteps } from "./briefing.ts";
import { encodeCall } from "./call.ts";
import { NETWORK } from "./network.ts";

/** What the network's money is called, in everything the tools say. */
const COIN = NETWORK.coin.symbol;
import { writeQrPng } from "./pairing-image.ts";
import { REFUSED_BY_ALLOWANCE, submitSpend } from "./spend.ts";
import { bundlerConfigured, bundlerSetupInstructions } from "./bundler.ts";
import { circleEscrow, escrowLedger, gatewayAccepting, readEscrow, topUpCalls, untilCredited, type Call } from "./gateway.ts";
import { fetchWithPayment, SELLER_WENT_QUIET, type BuyOutcome, type Funding } from "./x402.ts";
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
const { account: agent, created, path: keyPath } = loadOrCreateAgent(agentKeyPath());

/** Where the code is saved as an image, beside the agent's key. */
const PAIRING_IMAGE = join(dirname(keyPath), "pairing-code.png");

/**
 * The pairing link as a scannable code, because the two halves of this are on different devices.
 *
 * The agent runs on a laptop and the wallet lives on a phone, so pairing means moving 42 characters
 * between them — the one genuinely awkward step in the flow, and the first one anybody meets. A
 * code the phone can read turns it into pointing a camera.
 *
 * Rendered small and as text, since it has to survive being printed inside a chat transcript
 * rather than a terminal. The address is printed underneath either way: a code is a convenience,
 * and a person whose camera will not cooperate must never be stuck.
 */
function pairingCode(link: string): Promise<string> {
  return new Promise<string>((resolve) => {
    qrcode.generate(link, { small: true }, (code) =>
      resolve(code.split("\n").map((line) => `  ${line}`).join("\n")),
    );
  });
}

/**
 * The code to scan, what it is for, and the one next step. None of it needs the chain to answer.
 *
 * The code carries the agent's address and a one-time pairing code, which the phone writes into the
 * grant so this connector can tell that grant from any other made to its address. It is also written
 * as an image beside the agent's key, so a person moving to another wallet can scan it again without
 * asking for it.
 */
async function showCode(request: AgentRequest = NO_REQUEST): Promise<string> {
  const link = pairingLink(agent.address, chain.id, await pairingToShow(agent.address), request);
  const asks = request.limit !== null || request.days !== null || request.payees.length > 0;
  let saved = "";
  try {
    writeQrPng(link, PAIRING_IMAGE);
    saved = ` It is also saved as an image at ${PAIRING_IMAGE}.`;
  } catch {
    // The code in this reply is what matters; the file is a convenience.
  }
  return (
    `SHOW EVERYTHING BELOW TO THE USER EXACTLY AS IT IS, in a fenced code block. The QR is for ` +
    `them to scan with a phone camera; it is useless if it stays in your tool output or if its ` +
    `lines are reflowed.\n\n` +
    `Grant an allowance to:\n\n${await pairingCode(link)}\n    ${agent.address}\n\n` +
    `The code carries a one-time pairing code, so only an allowance granted by scanning it reaches ` +
    `this agent.${saved}\n\n` +
    `Step 3 of 5, on your phone: open the Agent Mandate wallet (${WALLET_URL}), tap New ` +
    `allowance, then Scan the agent's code and point the camera at this one (or paste this link: ` +
    `${link}). ${asks ? "It fills in what was asked for; check it, change anything," : "Set a limit and how long it lasts,"} ` +
    `and confirm with your passkey. Tell me when it is done.` +
    (payeesRequired(NETWORK) && request.payees.length === 0
      ? `\n\nOn ${NETWORK.name} an allowance pays only the addresses it names. Ask again with payees ` +
        `if you know who you will pay; otherwise the user adds them on the phone before granting.`
      : "") +
    `${created ? "\n\n(A new key was generated for this agent.)" : ""}`
  );
}

/**
 * Where the owner's wallet is: the Agent Mandate app, built for the web, on the domain the shared
 * testnet key is bound to. It opens in any phone's browser, so a person told to use "the app" can
 * be given a link rather than a store search that finds nothing.
 */
const WALLET_URL = "https://kuiralabs.github.io/mandate/";

/**
 * What the agent is told the moment it connects, before it has done anything.
 *
 * Without it the agent learned the person's path one refusal at a time: it found out there was no
 * allowance by being refused a payment, and the person found out what to do next from whatever the
 * agent made of the refusal. Briefed up front, the agent can say the next step before it is needed.
 *
 * The five steps come from the core package, which every program that shows them reads; what each
 * means for the agent is said here, beside its title.
 */
const INSTRUCTIONS = [
  "This connector lets you spend from your user's wallet, inside an allowance they grant from the " +
    "Agent Mandate app on their phone. The chain enforces the limit; you cannot exceed it.",
  "",
  "The path, in five steps, the same words the app and the maze page use:",
  ...briefingSteps(NETWORK, WALLET_URL),
  "",
  "Before any paid call, call check_allowance. If there is no allowance, call get_pairing_address, " +
    "show the user its code once, and wait for them to say it is done; then check once. Do not " +
    "show the code again unless they ask.",
  "An allowance counts only if it was granted by scanning the code get_pairing_address shows: the " +
    "code carries a one-time pairing code, and an allowance granted any other way is not used. To " +
    "move you to another wallet, the user scans a new code from that wallet.",
  "When you say what you can spend, or what you spent, name the wallet it comes from as the tools " +
    "do, so the user can match it to their app.",
  "check_allowance also names this agent's ERC-8004 identity, which the user's wallet owns. When a " +
    "seller asks for your agent id, for example as ?agent= when you start, give that number: it is " +
    "how what you earn reaches the user's wallet.",
  "When a payment is refused, tell the user the one next action the refusal names, and who does it.",
  "When a task is finished, say what it cost, and that the allowance stays until its end date and " +
    "can be revoked in the app.",
].join("\n");

const server = new McpServer({ name: "arc-mandate", version: "0.0.2" }, { instructions: INSTRUCTIONS });

/** An amount of the network's coin as a person reads it: dollars on Arc, MON on Monad. */
const inCoin = (wei: bigint): string => amountIn(NETWORK, wei);
/** Escrow and the online budget are both ERC-20 scale — six decimals, not eighteen. */
const online = (units: bigint): string => `$${formatUnits(units, 6)}`;
const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });
/** A wallet the way a person matches it against the app: its first and last characters. */
const walletName = (account: Address): string => `${account.slice(0, 6)}…${account.slice(-4)}`;
/** An amount as a person writes one: digits, with at most one decimal point. */
const DECIMAL = /^\d+(\.\d+)?$/;

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
    ? `${NETWORK.name}'s public endpoint is rate-limiting us. It clears on its own; try again shortly.`
    : `${NETWORK.name}'s endpoint did not answer.`;
}

/** Said when no grant carries this agent's code, and no wallet was ever paired with it. */
const NO_ALLOWANCE =
  `No allowance yet.\n\nStep 3 of 5, on the user's phone: in the Agent Mandate wallet ` +
  `(${WALLET_URL}), tap New allowance, then Scan the agent's code, set a limit and how long, and ` +
  `confirm with their passkey. Call ` +
  `get_pairing_address to show the code. It carries a one-time pairing code, and an allowance ` +
  `granted by typing this agent's address alone is not tied to it and will not be used.\n\n` +
  `Wait for the user to say it is done, then check once.`;

/**
 * Said when the only wallet known is one remembered from before grants carried a pairing code.
 *
 * Its allowance may well be live, and the agent could spend it, but nothing ties it to this agent's
 * owner, which is the whole point of pairing. So it is not spent from, and the owner scans once.
 */
const pairAgain = (legacy: Address): string =>
  `This agent needs pairing once more.\n\nIt holds an allowance from wallet ${walletName(legacy)}, ` +
  `granted before allowances carried a pairing code, so nothing ties it to this agent's owner and ` +
  `this connector will not spend from it. Nothing was bought and nothing was charged. Call ` +
  `get_pairing_address and show the user the new code; they scan it in the app with New allowance, ` +
  `from the wallet they want this agent to use. The old allowance can be revoked in the app.`;

/**
 * Money already moved into the agent's escrow, said when an allowance is withdrawn.
 *
 * Revoking stops the agent drawing on the wallet, and does not reach what earlier top-ups put in
 * escrow: that is the agent's at Circle's Gateway, spendable by its key, or withdrawn to its own
 * address after Circle's delay. Saying nothing let a person believe a revoke took everything back.
 */
async function escrowLeftBehind(): Promise<string> {
  let held: bigint;
  try {
    held = await spendableEscrow();
  } catch {
    return "\n\nWhether the agent still holds money in escrow from earlier top-ups could not be read just now.";
  }
  return held === 0n
    ? ""
    : `\n\nThe agent still holds ${online(held)} in escrow at Circle's Gateway from earlier top-ups. ` +
      `Revoking does not reach it: only this agent's key can spend it, or withdraw it to its own ` +
      `address after Circle's delay.`;
}

async function requireMandate() {
  let grant: Grant;
  try {
    grant = await findGrant(agent.address);
  } catch (cause) {
    // What is remembered still says something true, and is worth more than the failure.
    const granter = rememberedGranter(agent.address);
    throw new Error(
      `${unreachable(cause)} Nothing was bought and nothing was charged.` +
      (granter
        ? `\n\nThe last wallet this agent was paired with is ${granter}; whether it still allows ` +
          `spending could not be checked.`
        : ""),
    );
  }
  if (grant.status === "withdrawn") {
    throw new Error(
      `The allowance was withdrawn.\n\n${grant.account} granted this agent and has since revoked ` +
        `it on chain, so the wallet is closed to it and this connector will not spend. Nothing ` +
        `was bought and nothing was charged. If the user wants this agent to carry on, they grant ` +
        `it again in the app with New allowance, scanning the code get_pairing_address shows; ` +
        `until then there is nothing to retry.${await escrowLeftBehind()}`,
    );
  }
  if (grant.status === "unpaired") {
    throw new Error(grant.legacy === null ? NO_ALLOWANCE : pairAgain(grant.legacy));
  }
  const account = grant.account;
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
      "Returns this agent's code to grant an allowance to: a QR carrying its address and a " +
      "one-time pairing code, which the user scans with their phone. Says which wallet it spends " +
      "from, if one is paired. Call this when they ask how to connect, fund, or authorise this " +
      "agent. Nothing secret is in it.\n\n" +
      "REPRODUCE THE OUTPUT VERBATIM IN YOUR REPLY, inside a fenced code block, including every " +
      "line of the QR code. Do not summarise it, do not describe it, do not replace it with the " +
      "address alone, and do not tell the user to look at the tool output — they frequently " +
      "cannot see it. A QR code that stays in tool output is a QR code nobody can scan, and the " +
      "user is standing there holding a phone.",
    inputSchema: {
      app: z.string().optional().describe("Who is asking, as the app you work for names itself, shown on the phone as the request's source"),
      limit: z.string().optional().describe(`A limit to ask for, in ${COIN}, as a decimal string, e.g. "0.01", when the app you work for says what it needs`),
      days: z.number().int().optional().describe("How many days to ask the allowance to last, when the app says"),
      payees: z.array(z.string()).optional().describe("The only addresses the allowance should let you pay, when the app names them"),
      calls: z.array(z.object({
        contract: z.string().describe("The contract's address"),
        functions: z.array(z.string()).describe('Each function written exactly, like "takeSeat(uint256,uint8,address)"'),
      })).optional().describe("The contract functions the app needs you to call with the wallet, when it names them; only these will be allowed"),
    },
  },
  async ({ app, limit, days, payees, calls }) => {
    // What the app this agent works for asks the wallet to grant. The person sees every part of it on
    // the phone and can change it; a part that could not be read back is refused here, not printed.
    const asked = requestFrom({ app, limit, days, payees, calls });
    if ("problem" in asked) return text(`The code was not made: ${asked.problem} Ask again without it, or with it corrected.`);
    const { request } = asked;
    let grant: Grant;
    try {
      grant = await findGrant(agent.address);
    } catch (cause) {
      // The code is the agent's own address and a code of its own, both known without the chain,
      // and it is what the user needs next. Only whether an allowance already exists could not be
      // checked, so the reply says exactly that and shows the code anyway.
      return text(
        `${await showCode(request)}\n\n${unreachable(cause)} So whether this agent already has ` +
          `an allowance could not be checked. If you have granted one, ask me again in a moment.`,
      );
    }
    if (grant.status === "granted") {
      // Now that an allowance exists, spending is the next thing they will try — so if the
      // connector cannot reach a bundler, say so here rather than letting the first payment fail.
      return text(
        `This agent spends from wallet ${walletName(grant.account)} (${grant.account}).` +
          (bundlerConfigured()
            ? ""
            : `\n\nOne thing left before it can spend.\n\n${bundlerSetupInstructions()}`) +
          `\n\nTo move it to a different wallet, the user scans the code below with New allowance ` +
          `from that wallet. Until they do, it keeps spending from this one.\n\n` +
          `${await showCode(request)}`,
      );
    }
    const preface = grant.status === "withdrawn"
      ? `Wallet ${walletName(grant.account)} revoked this agent. To grant it again, scan this code.\n\n`
      : grant.legacy !== null
        ? `This agent was paired before allowances carried a pairing code, so its allowance from ` +
          `wallet ${walletName(grant.legacy)} is not used. Scanning this code once fixes that.\n\n`
        : "";
    return text(`${preface}${await showCode(request)}`);
  },
);

/**
 * One ledger: this connector is the only thing that spends this escrow, so what it has claimed is
 * exactly what the chain has not caught up with yet. Kept beside the agent's key, so a restart in
 * the quarter hour a batch takes does not forget what is still settling.
 */
const escrow = escrowLedger(
  rememberedEscrow(agent.address) ?? undefined,
  (tally) => rememberEscrow(agent.address, tally),
);

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
  let held: bigint;
  try {
    held = await spendableEscrow();
  } catch (cause) {
    return [`  escrow could not be read: ${unreachable(cause)}`];
  }
  if (held === 0n) return [];
  // "plus", not "of which": escrow is money the allowance already moved, so it is extra to the above.
  return [`  plus ${online(held)} already in escrow, spendable on the web without a top-up`];
}

/**
 * Operations from the owner's account under the allowance, read back for what they logged.
 *
 * Setting up an identity needs the number `register()` minted, and that is only in the logs.
 */
const submitFrom = (account: Address): Submit => async (calls) => {
  const result = await submitSpend({ agent, account, calls });
  if (!result.ok) return { ok: false, reason: result.reason };
  const receipt = await publicClient.getTransactionReceipt({ hash: result.hash });
  return { ok: true, logs: receipt.logs };
};

/** One setup at a time for each wallet, so two checks at once cannot register two identities. */
const settingUp = new Map<string, Promise<IdentityOutcome>>();

function identityFor(account: Address): Promise<IdentityOutcome> {
  const key = account.toLowerCase();
  const running = settingUp.get(key);
  if (running !== undefined) return running;
  const started = setUpIdentity({
    agent,
    owner: account,
    remembered: rememberedIdentity(agent.address, account),
    client: publicClient,
    submit: submitFrom(account),
    remember: (agentId) => rememberIdentity(agent.address, account, agentId),
  }).finally(() => settingUp.delete(key));
  settingUp.set(key, started);
  return started;
}

/**
 * The agent's ERC-8004 identity, as lines for `check_allowance`, set up first when it is missing.
 *
 * Said beside the allowance because that is what the agent reads before it plays anything, and the
 * number is what it gives a seller that rewards agents. Setting one up needs an allowance that is in
 * force and a connector that can submit, and when either is missing the line says which.
 */
async function identityLines(account: Address, allowance: Allowance): Promise<string[]> {
  if (allowance.expired || allowance.notYet) return [];
  if (!bundlerConfigured()) {
    return [
      "",
      "Identity: not set up yet. This connector cannot submit operations until it has a Circle " +
        "client key, and the first payment explains how to add one.",
    ];
  }
  let outcome: IdentityOutcome;
  try {
    outcome = await identityFor(account);
  } catch (cause) {
    return ["", `Identity: could not be checked. ${unreachable(cause)}`];
  }
  if (!outcome.ok) {
    return [
      "",
      `Identity: could not be set up (${outcome.reason}). ` +
        (outcome.reason.startsWith(REFUSED_BY_ALLOWANCE)
          ? "This allowance was granted before allowances let an agent set up its identity; a new " +
            "allowance from the app does. "
          : "") +
        "Payments still work, but a seller that rewards an identity cannot credit this wallet yet. " +
        "Checking again tries again.",
    ];
  }
  return [
    "",
    `Identity: ERC-8004 agent #${outcome.agentId}, owned by wallet ${walletName(account)}` +
      (outcome.registered ? ", set up just now." : "."),
    `When a seller asks for your ERC-8004 agent id, for example as ?agent= when you start, give ` +
      `${outcome.agentId}. What you earn is written to it${NETWORK.contracts.cohortBadge !== undefined ? `, and a badge goes to wallet ${walletName(account)}` : ""}.`,
  ];
}

server.registerTool(
  "check_allowance",
  {
    title: "Check the remaining allowance",
    description:
      "How much this agent may still spend. Call this before promising a purchase, and after a " +
      "refusal to see whether the limit or the payee was the problem. It also names this agent's " +
      "ERC-8004 identity, owned by the wallet it spends from; the first time it runs for a wallet it " +
      "sets that identity up, in two sponsored operations that move no money.",
    inputSchema: {},
  },
  async () => {
    const { account, allowance } = await requireMandate();
    return text(
      [
        `Spending from wallet ${walletName(account)} (${account})`,
        `  limit      ${allowance.limit} ${COIN}`,
        `  spent      ${allowance.spent} ${COIN}`,
        `  remaining  ${allowance.remaining} ${COIN}`,
        `  wallet     ${allowance.walletBalance} ${COIN}`,
        "",
        // The number to plan against. Three things bound a payment and the allowance is only one
        // of them, so reporting it alone is how an agent promises a purchase it cannot make.
        `  spendable now: ${allowance.spendable} ${COIN}`,
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
        // Escrow is money the allowance already moved to the agent, so it is extra to what is
        // spendable above; the two together are what this agent can spend right now.
        ...(await escrowLine(allowance)),
        ...(await identityLines(account, allowance)),
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
        `Nothing was sent. ${formatEther(value)} ${COIN} is finer than this allowance can pay — it ` +
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

/** An amount of the coin as an agent wrote it, or the sentence saying why it is not one. Nothing is sent either way. */
function amountOf(amount: string): { readonly value: bigint } | { readonly problem: string } {
  if (!DECIMAL.test(amount)) return { problem: `Nothing was sent. "${amount}" is not an amount; give it as a plain decimal, like 2.50.` };
  // Finer than the coin counts would round to nothing, and "must be positive" would not say why.
  const places = amount.split(".")[1]?.length ?? 0;
  if (places > NETWORK.coin.decimals) {
    return { problem: `Nothing was sent. ${COIN} counts to ${NETWORK.coin.decimals} decimal places, and "${amount}" has ${places}.` };
  }
  return { value: parseEther(amount) };
}

/**
 * Why a spend of `value` is refused before it is sent, or null when the allowance has room for it.
 *
 * Checked here purely so the agent gets a sentence it can act on. The chain refuses it either way; this
 * only avoids spending a round trip to be told so.
 */
function refusedBeforeSending(allowance: Awaited<ReturnType<typeof requireMandate>>["allowance"], value: bigint): string | null {
  if (allowance.expired) {
    return `Refused before sending: this allowance expired. Nothing was spent. Ask the user to grant ` +
      `a new one in the app with New allowance. The amount is not the problem; the window closed.`;
  }
  if (value <= allowance.spendableWei) return null;
  // Which bound was hit changes what the user should do about it, so say which.
  const walletIsTheLimit = allowance.walletBalanceWei < allowance.remainingWei;
  return `Refused before sending: ${inCoin(value)} exceeds the ${allowance.spendable} ${COIN} available. ` +
    (walletIsTheLimit
      ? `The allowance permits ${allowance.remaining} ${COIN} but the wallet only holds ` +
        `${allowance.walletBalance}, so the wallet is the limit — the user needs to add funds, ` +
        `not raise the allowance.`
      : `That is the allowance's remaining limit. Ask the user to raise it if this purchase ` +
        `is worth it — do not retry a smaller amount unless that actually satisfies the task.`);
}

server.registerTool(
  "pay",
  {
    title: "Pay for something",
    description:
      `Sends ${COIN} on ${NETWORK.name} from the user's wallet, within the allowance they granted. The limit is ` +
      "enforced by the chain, not by you: a payment over the allowance, or after it has been " +
      "revoked or has expired, is refused and moves no money. Never ask the user to raise a limit " +
      "mid-task; report the refusal and let them decide.",
    inputSchema: {
      to: z.string().describe("Recipient address (0x…)"),
      amount: z.string().describe(`Amount in ${COIN}, as a decimal string, e.g. "2.50"`),
      reason: z.string().optional().describe("What this buys, said back in the reply so the user can match it to the payment"),
    },
  },
  async ({ to, amount, reason }) => {
    if (!isAddress(to)) throw new Error(`Not an address: ${to}`);
    // Nobody holds the zero address, so a payment to it is lost; said here rather than learned from the chain.
    if (isAddressEqual(to, zeroAddress)) {
      return text("Nothing was sent. The zero address belongs to nobody, so a payment to it would be lost; give the payee's own address.");
    }
    const read = amountOf(amount);
    if ("problem" in read) return text(read.problem);
    const value = read.value;
    if (value <= 0n) throw new Error("Amount must be positive.");

    const { account, allowance } = await requireMandate();
    const refusal = refusedBeforeSending(allowance, value);
    if (refusal !== null) return text(refusal);

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
      `Paid ${inCoin(value)} to ${to}${reason ? ` for ${reason}` : ""}, from wallet ${walletName(account)}.\n` +
        `Transaction ${result.hash}\n` +
        `Remaining after this: about ${formatEther(allowance.remainingWei - value)} ${COIN}.`,
    );
  },
);

server.registerTool(
  "call",
  {
    title: "Call a contract function",
    description:
      `Calls one function on a contract on ${NETWORK.name} with the user's wallet, sending ${COIN} with it when ` +
      "the function takes payment, within the allowance they granted. Only the functions the allowance " +
      "names can be called: the app you work for names them in the code you show the user, and the " +
      "chain refuses anything else before it runs. Use it for an app's own steps, such as taking a seat " +
      "or approving work; use pay to send money to someone.",
    inputSchema: {
      contract: z.string().describe("The contract's address (0x…)"),
      function: z.string().describe('The function written exactly, like "takeSeat(uint256,uint8,address)"'),
      args: z.array(z.string()).describe("Its arguments in order, each written as text: numbers as digits, addresses as 0x…, true or false"),
      value: z.string().optional().describe(`${COIN} to send with the call, as a decimal string, when the function takes payment`),
      reason: z.string().optional().describe("What this does, said back in the reply so the user can match it to the transaction"),
    },
  },
  async ({ contract, function: signature, args, value: amount, reason }) => {
    if (!isAddress(contract)) throw new Error(`Not an address: ${contract}`);
    const call = encodeCall(signature, args);
    if ("problem" in call) return text(`Nothing was sent. ${call.problem}`);
    let value = 0n;
    if (amount !== undefined) {
      const read = amountOf(amount);
      if ("problem" in read) return text(read.problem);
      value = read.value;
    }

    const { account, allowance } = await requireMandate();
    const refusal = refusedBeforeSending(allowance, value);
    if (refusal !== null) return text(refusal);

    const result = await submitSpend({ agent, account, calls: [{ to: getAddress(contract), value, data: call.data }] });
    if (!result.ok) {
      if ("setup" in result) {
        return text(`Nothing was sent — this connector cannot submit yet.\n\n${result.reason}`);
      }
      return text(
        `The chain refused this call: ${result.reason}\n` +
          `Nothing was spent. Common causes: the allowance does not name ${call.name} on this contract (ask the ` +
          `user to grant one from a code that names it), the contract itself refused the arguments, the ` +
          `allowance is exhausted, or it was revoked.`,
      );
    }
    return text(
      `Called ${call.name} on ${contract}${value > 0n ? `, sending ${inCoin(value)}` : ""}` +
        `${reason ? ` for ${reason}` : ""}, from wallet ${walletName(account)}.\n` +
        `Transaction ${result.hash}` +
        (value > 0n ? `\nRemaining after this: about ${formatEther(allowance.remainingWei - value)} ${COIN}.` : ""),
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
  let held: bigint;
  try {
    held = await spendableEscrow();
  } catch (cause) {
    return { ok: false, reason: `${unreachable(cause)} Nothing was moved.` };
  }
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

  let accepting: Awaited<ReturnType<typeof gatewayAccepting>>;
  try {
    accepting = await gatewayAccepting();
  } catch (cause) {
    return { ok: false, reason: `${unreachable(cause)} Nothing was moved.` };
  }
  if (!accepting.ok) return { ok: false, reason: accepting.reason };

  const result = await submitSpend({ agent, account, calls: topUpCalls(agent.address, shortfall) });
  if (!result.ok) {
    if ("setup" in result) return { ok: false, reason: result.reason };
    return { ok: false, reason: `The top-up was refused: ${result.reason}` };
  }
  // The payment comes next, and Circle checks it against its own ledger, not the chain's.
  await untilCredited(needed, () => circleEscrow(agent.address));
  return { ok: true, toppedUp: shortfall };
}

/**
 * Buying from the open web pays x402 sellers from an escrow at Circle's Gateway, which only some networks
 * have. Where there is none the two tools are not offered at all, so an agent is never shown one it cannot use.
 */
if (NETWORK.contracts.gatewayWallet !== undefined) {
  server.registerTool(
    "buy",
    {
      title: "Buy something from a web address",
      description:
        "Fetches a URL and pays if it answers 402 Payment Required, using the x402 protocol. Use " +
        "this for paid APIs and paid pages rather than telling the user you cannot access them. " +
        "The same allowance bounds this and the chain enforces it, so an over-budget purchase is " +
        "refused and moves no money. Report a refusal; never ask for a bigger budget mid-task.",
      inputSchema: {
        url: z.string().describe("The address to fetch, e.g. https://api.example.com/report"),
        method: z.string().optional().describe("HTTP method, default GET"),
        reason: z.string().optional().describe("What this buys, said back in the reply so the user can match it to the payment"),
      },
    },
    async ({ url, method = "GET", reason }) => {
      const { account, allowance } = await requireMandate();
      let toppedUp = 0n;

      let outcome: BuyOutcome;
      try {
        outcome = await fetchWithPayment({
          url,
          method,
          agent,
          ensureFunds: async (needed: bigint): Promise<Funding> => {
            const funded = await fundEscrow({ account, allowance, needed });
            if (funded.ok) toppedUp = funded.toppedUp;
            return funded;
          },
        });
      } catch (cause) {
        // Only asking the price can throw here. The request carrying a payment is caught inside,
        // where whether the seller took it is unknown rather than impossible.
        return text(
          `Nothing was bought and nothing was spent. ${url} did not answer: ` +
            `${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      if (!outcome.paid) {
        if (outcome.perhapsCharged === true && outcome.amount !== undefined) {
          // Counted as spent until the escrow says otherwise, which errs toward topping up.
          escrow.claimed(outcome.amount);
          return text(outcome.problem ?? SELLER_WENT_QUIET);
        }
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
      if (!outcome.delivered) {
        return text(
          `Paid ${online(outcome.amount)} to ${outcome.payTo} from the agent's escrow, but the seller ` +
            `answered ${outcome.response.status} ${outcome.response.statusText} instead of delivering. ` +
            `The payment was taken, so do not retry as though it was not. Tell the user, and pass on ` +
            `what the seller said, which names the payment:\n\n${body.slice(0, 4000)}`,
        );
      }
      return text(
        [
          `Bought ${online(outcome.amount)} from ${outcome.payTo}${reason ? ` for ${reason}` : ""}, ` +
            `paid from the agent's escrow, which wallet ${walletName(account)} funds.`,
          toppedUp > 0n
            ? `Moved ${online(toppedUp)} from wallet ${walletName(account)} into the agent's escrow first.`
            : null,
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
      if (!DECIMAL.test(amount)) {
        return text(`Nothing was moved. "${amount}" is not an amount; give it as a plain decimal, like 0.50.`);
      }
      const wanted = parseUnits(amount, 6);
      if (wanted <= 0n) throw new Error("Amount must be positive.");

      // Added to what is *spendable*, not to what the chain shows. Against the chain's figure this
      // asks for whatever has not settled all over again, and escrow only leaves as a payment or a
      // delayed withdrawal — so the overshoot is money locked up for no reason.
      let held: bigint;
      try {
        held = await spendableEscrow();
      } catch (cause) {
        return text(`Nothing was moved. ${unreachable(cause)}`);
      }
      const funded = await fundEscrow({ account, allowance, needed: held + wanted });
      if (!funded.ok) return text(`Nothing was moved. ${funded.reason}`);
      const holds = await spendableEscrow().then(online, () => null);
      return text(
        `Moved ${online(funded.toppedUp)} from wallet ${walletName(account)} into the agent's escrow. ` +
          (holds === null
            ? "Its new balance could not be read just now."
            : `It now holds ${holds}, spendable on the web without further approval.`),
      );
    },
  );
}

await server.connect(new StdioServerTransport());
