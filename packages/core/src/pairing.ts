import { getAddress, isAddress, keccak256, parseAbiItem, toFunctionSignature, toHex, type Address, type Hex } from "viem";
import type { AllowedCalls } from "./grant.ts";

/**
 * Tying a grant to the code it was made from.
 *
 * Anyone can grant an allowance to an agent's address: granting needs nothing but the address, and
 * the address is public. So "the first grant naming this agent" is not the same as "the owner's
 * grant". A stranger's could be the one found, and an owner who granted again from a second wallet
 * was ignored in favour of the first.
 *
 * So the agent's code carries a one-time pairing code as well as its address. The phone writes a
 * hash of it into the grant's `tag`, which the session-key plugin records in `SessionKeyAdded` and
 * uses for nothing else, and which the event indexes, so the agent can ask the chain for exactly the
 * grants carrying its code. A grant made any other way carries no code the agent is waiting for, and
 * is not used.
 *
 * The phone app imports this file as well as the connector, so it holds nothing Node-only: both
 * sides must compute the same tag from the same code, and one definition is how they cannot drift.
 */

/** Written in front of the code before hashing, so a pairing tag cannot collide with a label tag. */
export const PAIRING_TAG_PREFIX = "arc-mandate pairing v1:";

/** Sixteen random bytes, as lowercase hex. */
const PAIRING_CODE = /^[0-9a-f]{32}$/;

export const isPairingCode = (value: string): boolean => PAIRING_CODE.test(value);

/** The tag a grant carrying this code writes into `SessionKeyAdded`. */
export function pairingTag(code: string): Hex {
  if (!isPairingCode(code)) throw new Error("a pairing code is 32 lowercase hex characters");
  return keccak256(toHex(`${PAIRING_TAG_PREFIX}${code}`));
}

/**
 * What the app an agent works for asks the wallet to grant, carried in the agent's code.
 *
 * The wallet knows no app. An app that wants its agents granted a certain way (a limit that fits what
 * it charges, how long a job lasts, the one contract it is paid through) tells its agent, the agent
 * hands that to its connector, and the connector prints it into the code. The phone shows every part
 * as a suggestion the person can change, and grants nothing the person did not see.
 */
export interface AgentRequest {
  /** who is asking, as the app names itself; shown as a claim, never trusted to mean anything */
  readonly app: string | null;
  /** the limit asked for, in the network's coin, as a decimal ("0.01") */
  readonly limit: string | null;
  /** how many days the allowance is asked to last */
  readonly days: number | null;
  /** the only addresses the agent may pay, when the app names them; empty when it names none */
  readonly payees: readonly Address[];
  /**
   * The contract functions the agent may call with the wallet, as the app names them: a seat taken, a
   * piece of work approved. Only these, and only on these contracts; empty when it names none.
   */
  readonly calls: readonly AllowedCalls[];
}

export const NO_REQUEST: AgentRequest = { app: null, limit: null, days: null, payees: [], calls: [] };

/** The longest name an app may give itself, so a code cannot fill the screen with its own words. */
export const MOST_APP_NAME = 40;
/** The most payees a request may name, so the code stays small enough to scan. */
export const MOST_PAYEES = 5;
/** The longest an allowance may be asked to last: ten years, as the wallet's own form allows. */
export const MOST_DAYS = 3650;
/** The most contracts a request may name functions on, and the most functions on each, so the code stays scannable. */
export const MOST_CALLED_CONTRACTS = 3;
export const MOST_FUNCTIONS = 5;
/** A positive decimal with at most eighteen places, as every coin here counts. */
const LIMIT = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
/** A name a person can read: letters, digits, spaces and plain punctuation, no control characters. */
const APP_NAME = /^[\p{L}\p{N} .,'&()\-]+$/u;

/** The parameter each part of a link travels under. */
const PARAM = { pairing: "pairing", app: "app", limit: "limit", days: "days", payees: "payees", calls: "calls" } as const;

/**
 * A function as the chain knows it, `name(type,type)`, or null when it is not one.
 *
 * Only the exact form is accepted, not a loose one the parser would tidy: `uint` and `uint256` are
 * the same to a reader and different functions to the chain, so a signature that is not already exact
 * would allow a function the app never meant.
 */
export function exactFunction(signature: string): string | null {
  try {
    const item = parseAbiItem(`function ${signature}`);
    if (item.type !== "function") return null;
    const exact = toFunctionSignature(item);
    return exact === signature ? exact : null;
  } catch {
    return null;
  }
}

/** The calls as they travel in a link: short keys, since every character makes the code denser. */
interface CallsOnTheWire { readonly c: string; readonly f: readonly string[] }

/** What the agent's QR encodes: an EIP-681 link to its address on its chain, carrying the code and any request. */
export function pairingLink(address: Address, chainId: number, code: string, request: AgentRequest = NO_REQUEST): string {
  const params = [`${PARAM.pairing}=${code}`];
  if (request.app !== null) params.push(`${PARAM.app}=${encodeURIComponent(request.app)}`);
  if (request.limit !== null) params.push(`${PARAM.limit}=${request.limit}`);
  if (request.days !== null) params.push(`${PARAM.days}=${request.days}`);
  if (request.payees.length > 0) params.push(`${PARAM.payees}=${request.payees.join(",")}`);
  if (request.calls.length > 0) {
    const wire: CallsOnTheWire[] = request.calls.map((call) => ({ c: call.contract, f: call.functions }));
    params.push(`${PARAM.calls}=${encodeURIComponent(JSON.stringify(wire))}`);
  }
  return `ethereum:${address}@${chainId}?${params.join("&")}`;
}

/** Why a request cannot be carried, or null when every part of it reads. */
export function requestProblem(request: AgentRequest): string | null {
  if (request.app !== null && (request.app.trim() !== request.app || request.app.length === 0 || request.app.length > MOST_APP_NAME || !APP_NAME.test(request.app))) {
    return `An app's name is up to ${MOST_APP_NAME} letters, digits, spaces and plain punctuation.`;
  }
  if (request.limit !== null && (!LIMIT.test(request.limit) || /^0(?:\.0+)?$/.test(request.limit))) {
    return "A limit is a decimal above zero, like 0.01.";
  }
  if (request.days !== null && !(Number.isInteger(request.days) && request.days >= 1 && request.days <= MOST_DAYS)) {
    return `A length is a whole number of days, from 1 to ${MOST_DAYS}.`;
  }
  if (request.payees.length > MOST_PAYEES || request.payees.some((payee) => !isAddress(payee, { strict: false }))) {
    return `Payees are up to ${MOST_PAYEES} addresses.`;
  }
  if (request.calls.length > MOST_CALLED_CONTRACTS || request.calls.some((call) =>
    !isAddress(call.contract, { strict: false }) || call.functions.length === 0 || call.functions.length > MOST_FUNCTIONS
    || call.functions.some((fn) => exactFunction(fn) === null))) {
    return `Calls name up to ${MOST_CALLED_CONTRACTS} contracts, each with 1 to ${MOST_FUNCTIONS} functions written exactly, like takeSeat(uint256,uint8,address).`;
  }
  return null;
}

/** A request as an agent hands it over, every part optional and the payees as written. */
export interface RequestInput {
  readonly app?: string | undefined;
  readonly limit?: string | undefined;
  readonly days?: number | undefined;
  readonly payees?: readonly string[] | undefined;
  readonly calls?: readonly { readonly contract: string; readonly functions: readonly string[] }[] | undefined;
}

/** An agent's request made ready to print, or why it cannot be. */
export function requestFrom(input: RequestInput): { readonly request: AgentRequest } | { readonly problem: string } {
  const written = input.payees ?? [];
  if (written.length > MOST_PAYEES || !written.every((payee) => isAddress(payee, { strict: false }))) {
    return { problem: `Payees are up to ${MOST_PAYEES} addresses.` };
  }
  const asked = input.calls ?? [];
  if (!asked.every((call) => isAddress(call.contract, { strict: false }))) {
    return { problem: `Calls name up to ${MOST_CALLED_CONTRACTS} contracts, each by its address.` };
  }
  const request: AgentRequest = {
    app: input.app ?? null, limit: input.limit ?? null, days: input.days ?? null, payees: written.map((payee) => getAddress(payee)),
    calls: asked.map((call) => ({ contract: getAddress(call.contract), functions: [...call.functions] })),
  };
  const problem = requestProblem(request);
  return problem === null ? { request } : { problem };
}

/** What a scanned or pasted code says: the agent's address, its pairing code when it has one, and what its app asks for. */
export interface ScannedAgent {
  readonly address: Address;
  readonly pairing: string | null;
  /** the chain the code names, after `@`, which is the network to grant on; null when it names none */
  readonly chainId: number | null;
  readonly request: AgentRequest;
}

/**
 * Read a scanned or pasted code.
 *
 * Accepts the link the connector prints, an `ethereum:` link with no code (what a wallet elsewhere
 * produces), and a bare address. A link whose pairing code is malformed is refused whole rather than
 * read as having none: that would grant an allowance the agent then ignores, with nothing saying why.
 * So is a link whose request does not read: dropping a part of it could widen what is granted, as a
 * list of payees read as no list would.
 *
 * Read by hand rather than with `URLSearchParams`, which React Native only partly implements.
 */
export function readPairingLink(scanned: string): ScannedAgent | null {
  const text = scanned.trim();
  // ethereum:0xabc… , optionally with @chainId, then ?params or a /function, per EIP-681.
  const uri = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:([?/])(.*))?$/.exec(text);
  const candidate = uri?.[1] ?? text;
  if (!isAddress(candidate)) return null;
  const chainId = uri?.[2] !== undefined ? Number(uri[2]) : null;
  // a chain id has to be one a wallet could grant on: a positive whole number it can hold exactly
  if (chainId !== null && !(Number.isSafeInteger(chainId) && chainId > 0)) return null;

  const query = uri?.[3] === "?" ? (uri[4] ?? "") : "";
  const valueOf = (name: string): string | null => {
    const part = query.split("&").find((each) => each.startsWith(`${name}=`));
    return part === undefined ? null : part.slice(name.length + 1);
  };
  const raw = valueOf(PARAM.pairing);
  if (raw === null) return { address: candidate, pairing: null, chainId, request: NO_REQUEST };
  const code = raw.toLowerCase();
  if (!isPairingCode(code)) return null;
  const request = readRequest(valueOf);
  return request === null ? null : { address: candidate, pairing: code, chainId, request };
}

/** The request in a link's parameters, or null when any part of it does not read. */
function readRequest(valueOf: (name: string) => string | null): AgentRequest | null {
  const days = valueOf(PARAM.days);
  const payees = valueOf(PARAM.payees);
  let app: string | null;
  try {
    const encoded = valueOf(PARAM.app);
    app = encoded === null ? null : decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (days !== null && !/^\d{1,4}$/.test(days)) return null;
  if (payees !== null && !payees.split(",").every((payee) => isAddress(payee, { strict: false }))) return null;
  const calls = readCalls(valueOf(PARAM.calls));
  if (calls === null) return null;
  const request: AgentRequest = {
    app,
    limit: valueOf(PARAM.limit),
    days: days === null ? null : Number(days),
    payees: payees === null ? [] : payees.split(",").map((payee) => getAddress(payee)),
    calls,
  };
  return requestProblem(request) === null ? request : null;
}

/** The calls a link names, none when it names none, or null when what it names does not read. */
function readCalls(encoded: string | null): readonly AllowedCalls[] | null {
  if (encoded === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const calls: AllowedCalls[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return null;
    const { c, f } = entry as Record<string, unknown>;
    if (typeof c !== "string" || !isAddress(c, { strict: false })) return null;
    if (!Array.isArray(f) || !f.every((fn): fn is string => typeof fn === "string")) return null;
    calls.push({ contract: getAddress(c), functions: f });
  }
  return calls;
}
