import { http, type HttpTransport } from "viem";
import type { NetworkProfile } from "./networks.ts";

/**
 * Reaching Circle's bundler and paymaster for a network: one endpoint per network, and the two headers
 * Circle checks a client key with. Plain HTTP, so it runs in Node, a page and the phone alike, which
 * Circle's own transport does not: it reads `window`.
 */

export interface CircleCredentials {
  readonly clientUrl: string;
  readonly clientKey: string;
  /** the domain the client key is bound to, which Circle checks against the `uri` in `X-AppInfo` */
  readonly passkeyDomain: string;
}

/**
 * The testnet values the Agent Mandate web wallet already publishes, so an agent can pay on testnet with
 * nothing to set up. Not secret: anyone who opens the wallet's page can read them, Circle refuses a test
 * key on mainnet, and a key authorises nothing alone, since a spend still needs a session key's
 * signature that the owner's mandate permits. What it shares is the gas: one testnet sponsorship policy
 * pays for every agent that uses it.
 */
export const CIRCLE_SHARED_TESTNET: CircleCredentials & { readonly networks: readonly string[] } = {
  clientUrl: "https://modular-sdk.circle.com/v1/rpc/w3s/buidl",
  clientKey: "TEST_CLIENT_KEY:cceea9ab4ce9e98783a9cf383500c81e:44f6b849d8c6ef8542136087fcf0ba31",
  passkeyDomain: "kuiralabs.github.io",
  // the networks its sponsorship was proven on: Arc since September, Monad on 3 Oct
  networks: ["arcTestnet", "monadTestnet"],
};

/** Whether the shared testnet key serves a network, so nothing has to be set up there. */
export const sharedKeyServes = (network: Pick<NetworkProfile, "circlePath">): boolean => CIRCLE_SHARED_TESTNET.networks.includes(network.circlePath);

/** Circle's endpoint for one network: the client URL, then the network's own path. */
export const circleEndpoint = (network: Pick<NetworkProfile, "circlePath">, clientUrl: string): string =>
  `${clientUrl.replace(/\/+$/, "")}/${network.circlePath}`;

/**
 * The headers Circle checks a client key with. Without `X-AppInfo` naming the key's domain, every call
 * is refused as "Invalid credentials", naming neither the key nor the domain.
 */
export const circleHeaders = (credentials: Pick<CircleCredentials, "clientKey" | "passkeyDomain">): Record<string, string> => ({
  Authorization: `Bearer ${credentials.clientKey}`,
  "X-AppInfo": `platform=web;version=1.0.0;uri=${credentials.passkeyDomain}`,
});

/** Circle's bundler and paymaster for a network, as a viem transport. */
export const circleTransport = (network: Pick<NetworkProfile, "circlePath">, credentials: CircleCredentials): HttpTransport =>
  http(circleEndpoint(network, credentials.clientUrl), { fetchOptions: { headers: circleHeaders(credentials) } });
