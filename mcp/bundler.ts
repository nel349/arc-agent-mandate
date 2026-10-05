/**
 * The bundler the agent hands its operations to.
 *
 * **The agent holds no money, and that is the point.** An allowance is authority, not a balance,
 * and an agent that quietly keeps a fraction of a dollar for itself has broken that promise
 * however small the fraction is. Nothing is ever transferred to the agent.
 *
 * That rules out self-submission. A user operation still travels inside an ordinary transaction,
 * and the account sending that transaction must hold a balance before it can send it — so an
 * agent that submits for itself must be funded first, and gets left with dust afterwards. The
 * only way around it is to hand the operation to someone else to submit.
 *
 * On Arc that someone is Circle: their bundler is the only one, checked rather than assumed —
 * Arc's public RPC answers `eth_supportedEntryPoints` with "method not supported", while Circle's
 * returns EntryPoint v0.7.
 *
 * **The credential this needs is not a secret.** It is the same client key the mobile app already
 * ships in its bundle, bound to a passkey domain, and it authorises nothing on its own: a spend
 * still needs a session-key signature that the mandate allows. Handing it to the agent gives away
 * no authority, which is why this is a better trade than leaving the agent holding money.
 *
 * The paymaster then covers the operation, so the **account pays no gas either** — which closes a
 * second problem. Submitting directly, the account was billed for every operation the agent ran,
 * and the mandate never counted it: the spend limit bounds `call.value`, so an agent could send a
 * trivial amount inside an expensive operation and cost the account far more than its allowance.
 * Sponsored, there is nothing to bill.
 */

import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { http } from "viem";
import { CIRCLE_SHARED_TESTNET, circleEndpoint, circleHeaders, sharedKeyServes } from "@kuiralabs/mandate-core";
import { NETWORK } from "./network.ts";

/**
 * Read when asked, never at import.
 *
 * These were module-scope constants, and that quietly broke loading a `.env`: ESM hoists every
 * `import` and runs it before any statement in the importing module, so this file captured an
 * empty `process.env` before `server.ts` had a chance to populate it. The connector then reported
 * itself unconfigured while sitting next to a file holding exactly the values it wanted.
 *
 * It survived review because the check used to confirm the fix — reading an allowance — needs no
 * credentials at all. Only paying does.
 */
const chainPath = () => process.env.ARC_CIRCLE_CHAIN_PATH ?? NETWORK.circlePath;


interface CircleConfig {
  readonly clientUrl: string | undefined;
  readonly clientKey: string | undefined;
  readonly passkeyDomain: string | undefined;
}

/**
 * The published testnet values, so a stranger's agent can pay on testnet with nothing to set up.
 *
 * Nothing here is secret. The key is the one the wallet's web build already carries, readable by
 * anyone who opens https://kuiralabs.github.io/mandate/, with the domain it is bound to. It is a
 * TEST key, which Circle refuses on mainnet, and it authorises nothing on its own: a spend still
 * needs a session-key signature that the owner's allowance permits.
 *
 * What it shares is the gas: every agent using it is sponsored by the one testnet policy behind the
 * key. That is test money, and the trade was chosen on 25 September so that connecting an agent
 * needs no Circle account. Mainnet has no such default; there you bring your own.
 */
const SHARED_TESTNET: CircleConfig = CIRCLE_SHARED_TESTNET;

const own = (): CircleConfig => ({
  clientUrl: process.env.CIRCLE_CLIENT_URL ?? process.env.EXPO_PUBLIC_CIRCLE_CLIENT_URL,
  clientKey: process.env.CIRCLE_CLIENT_KEY ?? process.env.EXPO_PUBLIC_CIRCLE_CLIENT_KEY,
  passkeyDomain: process.env.CIRCLE_PASSKEY_DOMAIN ?? process.env.EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN,
});

/**
 * Your own values if you set any, the shared ones on testnet if you set none.
 *
 * All or nothing: set one of your own and none of the shared ones fill the gaps, because a key of
 * yours sent with our domain, or ours with yours, is refused as "Invalid credentials" and names
 * neither. A partial setup is reported as missing instead, which names what to add.
 */
function circle(): CircleConfig {
  const mine = own();
  const setAny = Boolean(mine.clientUrl || mine.clientKey || mine.passkeyDomain);
  return !setAny && sharedKeyServes({ circlePath: chainPath() }) ? SHARED_TESTNET : mine;
}

/** Whether payments go through the shared testnet key rather than one of your own. */
export function usesSharedTestnetKey(): boolean {
  return circle() === SHARED_TESTNET;
}


/**
 * The bundler as a viem transport, so viem assembles the operation rather than us.
 *
 * Circle validates the domain-bound client key against the `uri` in `X-AppInfo`; without that
 * header every call is "Invalid credentials", naming neither the key nor the domain.
 */
export function circleTransport() {
  return http(endpoint(), { fetchOptions: { headers: headers() } });
}

export function bundlerConfigured() {
  const c = circle();
  return Boolean(c.clientUrl && c.clientKey && c.passkeyDomain);
}

export function missingBundlerConfig() {
  const c = circle();
  return [
    !c.clientUrl && "CIRCLE_CLIENT_URL",
    !c.clientKey && "CIRCLE_CLIENT_KEY",
    !c.passkeyDomain && "CIRCLE_PASSKEY_DOMAIN",
  ].filter(Boolean);
}

/**
 * What to tell someone who has not set this up yet.
 *
 * Written out in full, and written for the agent to relay, because this is the one wall a new
 * person hits and the worst possible response is a sentence naming three environment variables
 * they have never heard of. Everything except paying works without any of it — pairing and reading
 * an allowance need only a public RPC — so this arrives at the moment it is needed and not before.
 *
 * On testnet it arrives only for a partial setup, since with nothing set the shared testnet values
 * are used; on mainnet, which has no shared key, it arrives for everyone.
 */
export function bundlerSetupInstructions() {
  const missing = `Missing right now: ${missingBundlerConfig().join(", ")}.`;

  return [
    "Paying needs a Circle account, because Arc has no public bundler — Circle's is the only way",
    "to get a user operation on chain, and their Gas Station is what pays the gas so neither you",
    "nor the agent has to.",
    "",
    "On testnet this is only needed if you set some of these values but not all: set all three, or",
    "none and the connector uses the shared testnet key. On mainnet you need your own.",
    "",
    "It takes about five minutes, once:",
    "",
    "  1. Sign up at https://console.circle.com and open Wallets → Modular Wallets.",
    "  2. Create a Client Key. It is bound to a domain — use the same passkey domain the wallet",
    "     app is configured with, or the key is refused with 'Invalid credentials'.",
    "  3. On testnet, Gas Station is set up for you. On mainnet you create a policy and fund it.",
    "",
    ...whereToPutIt(),
    "",
    "Do not paste the key into this conversation — put it in the file. A key in a chat window",
    "stays in the transcript.",
    "",
    missing,
  ].join("\n");
}

/**
 * Where the keys go depends on how the connector was installed, and guessing wrong wastes the one
 * chance to be useful. Installed as a package it lives under `node_modules` and has no project
 * around it, so the values belong in the client's own config. Run from a checkout there is a
 * `.env` beside it, which is the shorter path and the one a developer already has open.
 */
function whereToPutIt() {
  if (installedAsPackage()) {
    return [
      "Then give the connector the values. Edit your client's MCP config — for Claude Code:",
      "",
      "  claude mcp remove arc-mandate",
      "  claude mcp add-json arc-mandate '{",
      '    "command": "npx", "args": ["-y", "@kuiralabs/arc-mandate"],',
      '    "env": {',
      '      "CIRCLE_CLIENT_URL": "https://modular-sdk.circle.com/v1/rpc/w3s/buidl",',
      '      "CIRCLE_CLIENT_KEY": "TEST_CLIENT_KEY:…",',
      '      "CIRCLE_PASSKEY_DOMAIN": "your-passkey-domain"',
      "    } }'",
      "",
      "For Claude Desktop, add the same `env` block to the arc-mandate entry in",
      "~/Library/Application Support/Claude/claude_desktop_config.json.",
      "",
      "Then restart your client — an MCP server is only launched at startup.",
    ];
  }

  return [
    `Then add these three lines to ${envPath()} and restart your client:`,
    "",
    "  CIRCLE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl",
    "  CIRCLE_CLIENT_KEY=TEST_CLIENT_KEY:…",
    "  CIRCLE_PASSKEY_DOMAIN=your-passkey-domain",
    "",
    "The connector reads that file itself, so nothing needs to change in your client's config.",
    "An MCP server is only launched at startup, so the restart is what picks the values up.",
  ];
}

/** Under `node_modules` means installed; anywhere else means someone is working in the checkout. */
function installedAsPackage() {
  return fileURLToPath(import.meta.url).includes(`${sep}node_modules${sep}`);
}

function envPath() {
  return join(dirname(dirname(fileURLToPath(import.meta.url))), ".env");
}


const endpoint = () => circleEndpoint({ circlePath: chainPath() }, circle().clientUrl ?? "");

/**
 * Circle validates the domain-bound client key against the `uri` in this header. Without it every
 * call is "Invalid credentials", naming neither the key nor the domain.
 */
const headers = () => circleHeaders({ clientKey: circle().clientKey ?? "", passkeyDomain: circle().passkeyDomain ?? "" });

