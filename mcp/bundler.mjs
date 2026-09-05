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

const CLIENT_URL = process.env.CIRCLE_CLIENT_URL ?? process.env.EXPO_PUBLIC_CIRCLE_CLIENT_URL;
const CLIENT_KEY = process.env.CIRCLE_CLIENT_KEY ?? process.env.EXPO_PUBLIC_CIRCLE_CLIENT_KEY;
const PASSKEY_DOMAIN =
  process.env.CIRCLE_PASSKEY_DOMAIN ?? process.env.EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN;
const CHAIN_PATH = process.env.ARC_CIRCLE_CHAIN_PATH ?? "arcTestnet";


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
  return Boolean(CLIENT_URL && CLIENT_KEY && PASSKEY_DOMAIN);
}

export function missingBundlerConfig() {
  return [
    !CLIENT_URL && "CIRCLE_CLIENT_URL",
    !CLIENT_KEY && "CIRCLE_CLIENT_KEY",
    !PASSKEY_DOMAIN && "CIRCLE_PASSKEY_DOMAIN",
  ].filter(Boolean);
}

const endpoint = () => `${CLIENT_URL.replace(/\/$/, "")}/${CHAIN_PATH}`;

/**
 * Circle validates the domain-bound client key against the `uri` in this header. Without it every
 * call is "Invalid credentials", naming neither the key nor the domain.
 */
const headers = () => ({
  "content-type": "application/json",
  Authorization: `Bearer ${CLIENT_KEY}`,
  "X-AppInfo": `platform=web;version=1.0.0;uri=${PASSKEY_DOMAIN}`,
});

