import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { isPairingCode, MOST_APP_NAME, MOST_PAYEES, NO_REQUEST, pairingLink, pairingTag, readPairingLink, requestFrom, requestProblem, type AgentRequest } from "./pairing.ts";

const AGENT = "0xB8A53c985E437000C4e77300690B00B146D293D2";
const CODE = "0123456789abcdef0123456789abcdef";

/**
 * The phone computes this tag and the connector searches for it. If the two ever computed it
 * differently, every grant would be ignored, and nothing would say why.
 */
test("a code has one tag, the same every time and different for every code", () => {
  assert.equal(pairingTag(CODE), pairingTag(CODE));
  assert.notEqual(pairingTag(CODE), pairingTag("fedcba9876543210fedcba9876543210"));
  assert.match(pairingTag(CODE), /^0x[0-9a-f]{64}$/);
});

/** The app's other tag is a hash of a label. A pairing tag must never equal one. */
test("a pairing tag cannot be mistaken for a label tag", () => {
  for (const label of ["agent", "mandate", CODE]) {
    assert.notEqual(pairingTag(CODE), keccak256(toHex(label)));
  }
});

test("only a real code has a tag", () => {
  assert.throws(() => pairingTag("not a code"), /32 lowercase hex/);
  assert.throws(() => pairingTag(CODE.toUpperCase()), /32 lowercase hex/);
  assert.equal(isPairingCode(CODE), true);
  assert.equal(isPairingCode(CODE.slice(1)), false);
});

test("the link the agent shows reads back as its address and its code", () => {
  const link = pairingLink(AGENT, 5042002, CODE);
  assert.equal(link, `ethereum:${AGENT}@5042002?pairing=${CODE}`);
  assert.deepEqual(readPairingLink(link), { address: AGENT, pairing: CODE, chainId: 5042002, request: NO_REQUEST });
});

test("the chain the code names is read, so the wallet grants on the network the agent is on", () => {
  assert.equal(readPairingLink(pairingLink(AGENT, 10143, CODE))?.chainId, 10143);
  assert.equal(readPairingLink(pairingLink(AGENT, 5042002, CODE))?.chainId, 5042002);
  // a code that names no chain leaves the choice to the wallet
  assert.equal(readPairingLink(`ethereum:${AGENT}?pairing=${CODE}`)?.chainId, null);
  assert.equal(readPairingLink(AGENT)?.chainId, null);
});

test("a chain id no wallet could grant on is refused, rather than read as some other chain", () => {
  assert.equal(readPairingLink(`ethereum:${AGENT}@0?pairing=${CODE}`), null);
  assert.equal(readPairingLink(`ethereum:${AGENT}@99999999999999999999?pairing=${CODE}`), null);
});

/** Older connectors print a bare address, and other wallets print plain links. Both still read. */
test("a code with no pairing reads as an address with no pairing", () => {
  assert.deepEqual(readPairingLink(AGENT), { address: AGENT, pairing: null, chainId: null, request: NO_REQUEST });
  assert.deepEqual(readPairingLink(`ethereum:${AGENT}@5042002`), { address: AGENT, pairing: null, chainId: 5042002, request: NO_REQUEST });
  assert.deepEqual(readPairingLink(`ethereum:pay-${AGENT}?value=1`), { address: AGENT, pairing: null, chainId: null, request: NO_REQUEST });
});

test("the code is found among other parameters, in any case", () => {
  assert.deepEqual(
    readPairingLink(`ethereum:${AGENT}@5042002?value=0&pairing=${CODE.toUpperCase()}`),
    { address: AGENT, pairing: CODE, chainId: 5042002, request: NO_REQUEST },
  );
});

/**
 * Read as "no pairing", a damaged code would lead to a grant the agent ignores. Refused, the person
 * is told the code did not read and scans again.
 */
test("a link with a damaged code is refused whole", () => {
  assert.equal(readPairingLink(`ethereum:${AGENT}@5042002?pairing=${CODE.slice(2)}`), null);
  assert.equal(readPairingLink(`ethereum:${AGENT}@5042002?pairing=`), null);
});

test("anything that is not an agent's code is refused rather than half read", () => {
  for (const scanned of ["https://example.com", "0xnope", `${AGENT}extra`, "0x", "", "ethereum:notanaddress"]) {
    assert.equal(readPairingLink(scanned), null, `accepted ${JSON.stringify(scanned)}`);
  }
});

/**
 * What an app asks for travels in the code and is read back exactly, so the phone can show it and the
 * person can change it. The wallet itself names no app: whatever is shown came from the code.
 */
const PAYEE = "0xc831b6e4414E064F7713A3b6017be4a1Eb9F5E9b";
const ASKED: AgentRequest = { app: "Jobs & Co. (test)", limit: "0.01", days: 7, payees: [PAYEE], calls: [] };
const SEATS: AgentRequest["calls"] = [{ contract: PAYEE, functions: ["takeSeat(uint256,uint8,address)", "approve(uint256,uint8,bytes32)"] }];

test("an app's request reads back exactly as it was asked, its name and all", () => {
  const link = pairingLink(AGENT, 10143, CODE, ASKED);
  assert.deepEqual(readPairingLink(link), { address: AGENT, pairing: CODE, chainId: 10143, request: ASKED });
  // the name travels encoded, so its spaces and punctuation cannot break the link
  assert.match(link, /app=Jobs%20%26%20Co\.%20\(test\)/);
});

test("a request may ask for any part alone, and what it leaves out is the person's to answer", () => {
  const onlyLimit: AgentRequest = { ...NO_REQUEST, limit: "5" };
  assert.deepEqual(readPairingLink(pairingLink(AGENT, 5042002, CODE, onlyLimit))?.request, onlyLimit);
  assert.equal(pairingLink(AGENT, 5042002, CODE, NO_REQUEST), `ethereum:${AGENT}@5042002?pairing=${CODE}`);
});

test("payees are read checksummed, however the app wrote them", () => {
  const link = `ethereum:${AGENT}@10143?pairing=${CODE}&payees=${PAYEE.toLowerCase()}`;
  assert.deepEqual(readPairingLink(link)?.request.payees, [PAYEE]);
});

/** Read as no list, a damaged list of payees would let the agent pay anyone. Refused, nothing is granted. */
test("a code whose request does not read is refused whole, rather than granted wider than asked", () => {
  const base = `ethereum:${AGENT}@10143?pairing=${CODE}`;
  for (const damaged of [
    `${base}&payees=${PAYEE},0xnope`,
    `${base}&limit=0`,
    `${base}&limit=-1`,
    `${base}&limit=1e3`,
    `${base}&days=0`,
    `${base}&days=3651`,
    `${base}&days=1.5`,
    `${base}&app=%E0%A4%A`,
    `${base}&app=${"a".repeat(MOST_APP_NAME + 1)}`,
    `${base}&app=%0Ahidden`,
    `${base}&payees=${Array.from({ length: MOST_PAYEES + 1 }, () => PAYEE).join(",")}`,
  ]) {
    assert.equal(readPairingLink(damaged), null, `accepted ${damaged}`);
  }
});

test("a request that could not be read back is refused before it is printed", () => {
  assert.equal(requestProblem(ASKED), null);
  assert.match(String(requestProblem({ ...NO_REQUEST, limit: "0.0" })), /above zero/);
  assert.match(String(requestProblem({ ...NO_REQUEST, days: 0 })), /whole number of days/);
  assert.match(String(requestProblem({ ...NO_REQUEST, app: " padded " })), /name/);
  assert.match(String(requestProblem({ ...NO_REQUEST, payees: ["0xnope" as never] })), /Payees/);
});

test("what an agent hands over becomes a request, its payees checksummed, or the reason it cannot", () => {
  assert.deepEqual(requestFrom({ app: ASKED.app ?? undefined, limit: "0.01", days: 7, payees: [PAYEE.toLowerCase()] }), { request: ASKED });
  assert.deepEqual(requestFrom({ calls: [{ contract: PAYEE.toLowerCase(), functions: [...(SEATS[0]?.functions ?? [])] }] }), { request: { ...NO_REQUEST, calls: SEATS } });
  assert.ok("problem" in requestFrom({ calls: [{ contract: "0xnope", functions: ["f()"] }] }));
  assert.deepEqual(requestFrom({}), { request: NO_REQUEST });
  assert.ok("problem" in requestFrom({ payees: ["0xnope"] }));
  assert.ok("problem" in requestFrom({ limit: "free" }));
});

/**
 * An app names the functions its agent calls with the wallet, and the code carries exactly those. A
 * loose signature would name a different function than the contract's, so only the exact form reads.
 */
test("the functions an app names travel in the code and read back exactly", () => {
  const asked: AgentRequest = { ...NO_REQUEST, limit: "1", calls: SEATS };
  assert.deepEqual(readPairingLink(pairingLink(AGENT, 10143, CODE, asked))?.request, asked);
});

test("a function not written exactly, or more than a code may name, is refused rather than allowed loosely", () => {
  const link = (calls: unknown) => `ethereum:${AGENT}@10143?pairing=${CODE}&calls=${encodeURIComponent(JSON.stringify(calls))}`;
  for (const calls of [
    [{ c: PAYEE, f: ["takeSeat(uint,uint8,address)"] }],
    [{ c: PAYEE, f: ["takeSeat(uint256 jobId,uint8,address)"] }],
    [{ c: PAYEE, f: [] }],
    [{ c: "0xnope", f: ["f()"] }],
    [{ c: PAYEE, f: ["a()", "b()", "c()", "d()", "e()", "g()"] }],
    Array.from({ length: 4 }, () => ({ c: PAYEE, f: ["f()"] })),
    { c: PAYEE, f: ["f()"] },
  ]) {
    assert.equal(readPairingLink(link(calls)), null, `accepted ${JSON.stringify(calls)}`);
  }
  assert.equal(readPairingLink(`ethereum:${AGENT}@10143?pairing=${CODE}&calls=%7Bnot-json`), null);
});
