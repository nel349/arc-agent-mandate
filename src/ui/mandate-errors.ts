/**
 * Turning a failure into a sentence someone holding a phone can act on.
 *
 * Separate from the hook so it can be tested without a renderer — and it needed testing, because
 * for a long time none of it worked. See `describeMandateFailure`.
 */

/**
 * One sentence a person can act on.
 *
 * Library errors are written for whoever is debugging the library. Viem's read failure is nine
 * lines of prose about three possible causes, none of which mean anything to someone holding a
 * phone — so the known shapes get named, and anything unrecognised is trimmed to its first line
 * with the detail left in the console for whoever is debugging.
 */
/**
 * Every message in an error's `cause` chain, outermost first.
 *
 * The SDK wraps failures — `MandateError: granting 20.000000 USDC to 0x… failed` — with the real
 * reason underneath in `cause`. Matching on the outer message alone meant every pattern below was
 * tested against the wrapper and none of them could ever match, so a bundler rejection, a
 * paymaster refusal and a revert all arrived as the same unhelpful sentence. The reason existed
 * the whole time, one link down.
 */
function causeChain(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  // Bounded: a cause cycle would otherwise hang the screen rather than report anything.
  for (let depth = 0; current !== undefined && current !== null && depth < 8; depth++) {
    messages.push(describeLink(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages;
}

/**
 * One link, including the fields that actually say what went wrong.
 *
 * `message` alone is not enough, and finding that out cost a round trip. A bundler rejection
 * arrives as `execution reverted` with the useful part — a four-byte error selector and its
 * arguments — hanging off `data.revertData`, which never reaches the message string. The failure
 * that produced this had `RuntimeValidationFailed(multisig, 0, NotImplemented(...))` sitting in
 * that field while the screen said "granting 20.000000 USDC failed" and the log said nothing.
 *
 * viem spreads its own detail across `shortMessage`, `details` and `metaMessages`, and JSON-RPC
 * errors nest theirs under `data`. All of them are worth more than the sentence.
 */
function describeLink(link: unknown): string {
  if (!(link instanceof Error)) return String(link);

  const extra: string[] = [];
  const carrier = link as Error & {
    shortMessage?: unknown; details?: unknown; metaMessages?: unknown; code?: unknown;
    data?: { revertData?: unknown } | unknown;
  };
  const revertData = (carrier.data as { revertData?: unknown } | undefined)?.revertData;

  if (typeof carrier.code === "number") extra.push(`code=${carrier.code}`);
  if (typeof carrier.shortMessage === "string" && carrier.shortMessage !== link.message) {
    extra.push(carrier.shortMessage);
  }
  if (typeof carrier.details === "string") extra.push(`details=${carrier.details}`);
  // The selector alone identifies the revert; the arguments follow it.
  if (typeof revertData === "string") extra.push(`revertData=${revertData}`);
  if (Array.isArray(carrier.metaMessages)) extra.push(...carrier.metaMessages.map(String));

  return [`${link.name}: ${link.message}`, ...extra].join(" | ");
}

export function describeMandateFailure(cause: unknown): string {
  const chain = causeChain(cause);
  const raw = chain.join("\n");
  // Each link on its own line. A nested `cause` is not expanded by React Native's console, so
  // logging the error object alone showed the wrapper and hid the reason.
  console.error("[mandate] " + chain.map((m, i) => `${"  ".repeat(i)}${i > 0 ? "caused by " : ""}${m}`).join("\n"));

  if (/returned no data|is not a contract/i.test(raw)) {
    return "The allowance contract is not deployed on this network yet.";
  }
  if (/insufficient|exceeds balance/i.test(raw)) {
    return "Not enough USDC in the wallet to cover this.";
  }
  if (/user rejected|cancell?ed|NotAllowedError/i.test(raw)) {
    return "Cancelled.";
  }
  if (/network|fetch failed|timeout|ECONN/i.test(raw)) {
    return "Could not reach Arc. Check the connection and try again.";
  }
  if (/PermissionsCheckFailed|AA2[0-9]/i.test(raw)) {
    return "The account refused this. The allowance may have been used up or revoked.";
  }
  // Unknown: the innermost message, which is the one that says what actually happened — the outer
  // links are our own wrappers. The whole chain is in the console above.
  return chain[chain.length - 1]!.split("\n")[0]!.slice(0, 160);
}
