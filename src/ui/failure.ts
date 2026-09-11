import { isRateLimited } from "../arc/client.ts";

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

export /**
 * Did the person dismiss the passkey prompt?
 *
 * Cancelling is not a failure, and it is the most common way any of these end. It has to be
 * recognised by the words the platform actually uses, which say nothing about cancelling: iOS
 * reports `com.apple.AuthenticationServices.AuthorizationError error 1001` wrapped in ox's
 * `CredentialRequestFailedError: Failed to request credential`. None of "cancelled", "rejected" or
 * `NotAllowedError` appears anywhere in it, so the old check could never match and a dismissed
 * prompt reached the screen as library prose about a credential request.
 *
 * 1001 is `ASAuthorizationError.canceled` specifically. The neighbouring codes are real failures
 * and are deliberately not swept in here — `.failed` reads the same to a matcher and means
 * something went wrong.
 */
function wasCancelled(text: string): boolean {
  return (
    /AuthorizationError error 1001/i.test(text) ||
    /\bNotAllowedError\b|\bAbortError\b/i.test(text) ||
    /user (rejected|cancell?ed|denied)/i.test(text) ||
    /\bcancell?ed by (the )?user\b/i.test(text)
  );
}

/**
 * Did an error, however deeply it was wrapped, end with the passkey prompt dismissed?
 *
 * The same rule `describeFailure` applies, reading the whole chain of causes, for a caller that has
 * to decide whether to say anything at all. iOS's returning-user request reports "no passkey here"
 * with the same code as a person closing the sheet, and both are ordinary endings.
 */
export function isCancellation(cause: unknown): boolean {
  return wasCancelled(causeChain(cause).join("\n"));
}

/**
 * Failures only the allowance screen can have.
 *
 * Kept here rather than beside the hook so that every sentence a person can be shown lives in one
 * module. Domain rules are *data*; which set applies is the caller's business, but the words are
 * not scattered across the app.
 */
/**
 * What a refusal for asking too often says. It names the cause as Arc's, because it is, and says
 * nothing needs doing, because nothing does: the next read is already scheduled.
 */
export const ARC_BUSY = "Arc is busy right now. The figures will catch up in a few seconds.";

export const MANDATE_FAILURES = [
  [/returned no data|is not a contract/i, "The allowance contract is not deployed on this network yet."],
  [/PermissionsCheckFailed|AA2[0-9]/i, "The account refused this. The allowance may have been used up or revoked."],
] as const;

/** Failures only the wallet ceremony can have. */
export const WALLET_FAILURES = [
  [/relying party|rp\.id|not associated with domain/i,
   "This app is not associated with the passkey domain yet."],
] as const;

export function describeFailure(
  cause: unknown,
  /**
   * Tried before the shared rules, so each caller can name the failures only it can have. A
   * missing allowance contract means something to the mandate screen and nothing to a wallet.
   */
  domainRules: readonly (readonly [RegExp, string])[] = [],
): string {
  const chain = causeChain(cause);
  const raw = chain.join("\n");
  // Each link on its own line. A nested `cause` is not expanded by React Native's console, so
  // logging the error object alone showed the wrapper and hid the reason.
  //
  // Dismissing a prompt is a normal outcome, not a fault, and `console.error` puts a red box and a
  // stack trace on the screen for it — which reads as something being broken when nothing is.
  const report = "[mandate] " + chain.map((m, i) => `${"  ".repeat(i)}${i > 0 ? "caused by " : ""}${m}`).join("\n");
  // A busy public endpoint is not a fault in this app either, and a red box on the phone says it is.
  const busy = isRateLimited(cause);
  if (wasCancelled(raw)) console.log(report);
  else if (busy) console.warn(report);
  else console.error(report);

  if (/insufficient|exceeds balance/i.test(raw)) {
    return "Not enough USDC in the wallet to cover this.";
  }
  if (wasCancelled(raw)) return "Cancelled. Nothing changed.";
  if (busy) return ARC_BUSY;

  for (const [pattern, message] of domainRules) {
    if (pattern.test(raw)) return message;
  }
  if (/network|fetch failed|timeout|ECONN/i.test(raw)) {
    return "Could not reach Arc. Check the connection and try again.";
  }
  // Unknown: the innermost message, which is the one that says what actually happened — the outer
  // links are our own wrappers. The whole chain is in the console above.
  //
  // A thrown `null` or `undefined` produces no chain at all. Rare, but it happens — a rejected
  // promise with no reason — and an error handler that throws is the worst place to find out.
  const innermost = chain.at(-1);
  if (innermost === undefined) return "Something failed without saying what.";
  return (innermost.split("\n")[0] ?? innermost).slice(0, 160);
}
