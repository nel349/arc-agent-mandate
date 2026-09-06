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

import { http } from "viem";

/**
 * Read when asked, never at import.
 *
 * These were module-scope constants, and that quietly broke loading a `.env`: ESM hoists every
 * `import` and runs it before any statement in the importing module, so this file captured an
 * empty `process.env` before `server.mjs` had a chance to populate it. The connector then reported
 * itself unconfigured while sitting next to a file holding exactly the values it wanted.
 *
 * It survived review because the check used to confirm the fix — reading an allowance — needs no
 * credentials at all. Only paying does.
 */
const clientUrl = () => process.env.CIRCLE_CLIENT_URL ?? process.env.EXPO_PUBLIC_CIRCLE_CLIENT_URL;
const clientKey = () => process.env.CIRCLE_CLIENT_KEY ?? process.env.EXPO_PUBLIC_CIRCLE_CLIENT_KEY;
const passkeyDomain = () =>
  process.env.CIRCLE_PASSKEY_DOMAIN ?? process.env.EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN;
const chainPath = () => process.env.ARC_CIRCLE_CHAIN_PATH ?? "arcTestnet";


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
  return Boolean(clientUrl() && clientKey() && passkeyDomain());
}

export function missingBundlerConfig() {
  return [
    !clientUrl() && "CIRCLE_CLIENT_URL",
    !clientKey() && "CIRCLE_CLIENT_KEY",
    !passkeyDomain() && "CIRCLE_PASSKEY_DOMAIN",
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
 * The alternative was shipping a default key so nothing had to be configured. It was rejected on
 * purpose: a shared key means everyone's gas comes out of one policy, and the honest version of
 * this product is that you bring your own.
 */
export function bundlerSetupInstructions() {
  return [
    "Paying needs a Circle account, because Arc has no public bundler — Circle's is the only way",
    "to get a user operation on chain, and their Gas Station is what pays the gas so neither you",
    "nor the agent has to.",
    "",
    "It takes about five minutes, once:",
    "",
    "  1. Sign up at https://console.circle.com and open Wallets → Modular Wallets.",
    "  2. Create a Client Key. It is bound to a domain — use the same passkey domain the wallet",
    "     app is configured with, or the key is refused with 'Invalid credentials'.",
    "  3. On testnet, Gas Station is set up for you. On mainnet you create a policy and fund it.",
    "",
    "Then give this connector the values and restart your client:",
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
    `Missing right now: ${missingBundlerConfig().join(", ")}.`,
  ].join("\n");
}

const endpoint = () => `${clientUrl().replace(/\/$/, "")}/${chainPath()}`;

/**
 * Circle validates the domain-bound client key against the `uri` in this header. Without it every
 * call is "Invalid credentials", naming neither the key nor the domain.
 */
const headers = () => ({
  "content-type": "application/json",
  Authorization: `Bearer ${clientKey()}`,
  "X-AppInfo": `platform=web;version=1.0.0;uri=${passkeyDomain()}`,
});

