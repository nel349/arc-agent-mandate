/**
 * Stands in for the `web3` package, which `@circle-fin/modular-wallets-core` pulls in — 11.4 MB
 * across 19 packages — to use **one symbol, once**, to throw:
 *
 *     import { ResponseError } from "web3";
 *     …
 *     throw new ResponseError(response);
 *
 * Metro aliases `web3` here (see `metro.config.js`), which keeps the whole subtree out of the
 * bundle. If a future SDK version imports anything else from `web3`, the build fails loudly at
 * that import rather than silently shipping megabytes — which is the behaviour we want.
 */
export class ResponseError extends Error {
  readonly response: unknown;
  constructor(response: unknown, message?: string) {
    super(message ?? "Circle RPC response error");
    this.name = "ResponseError";
    this.response = response;
  }
}
