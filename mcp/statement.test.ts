import { test } from "node:test";
import assert from "node:assert/strict";
import { hashTypedData, recoverMessageAddress, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { statementToSign, type StatementProblem, type ToSign } from "./statement.ts";

/** POD's door statement, as its guide publishes it: the one an agent signs to be let into a job's repository */
const DOOR = "Door(string job,uint256 number,address seat,string role,uint64 until)";
const JOBS = "0xc831b6e4414E064F7713A3b6017be4a1Eb9F5E9b";
const SEAT = "0xB0D5AB6792a6abdF22d35e02F6525ae13Afd8e55";
const VALUES = ["a-coat-given-the-rain", "10", SEAT, "builder", "1791000000"];
const agent = privateKeyToAccount(`0x${"4d".repeat(32)}`);

const asked = (over: Partial<Parameters<typeof statementToSign>[0]> = {}) =>
  statementToSign({ app: "POD", version: "1", contract: JOBS, chainId: 10143, statement: DOOR, values: VALUES, ...over });

const problem = (over: Partial<Parameters<typeof statementToSign>[0]>): string => (asked(over) as StatementProblem).problem ?? "";

test("a statement reads as the structure an app publishes, every field in its type", () => {
  const toSign = asked() as ToSign;
  assert.deepEqual(toSign.types, {
    Door: [
      { name: "job", type: "string" },
      { name: "number", type: "uint256" },
      { name: "seat", type: "address" },
      { name: "role", type: "string" },
      { name: "until", type: "uint64" },
    ],
  });
  assert.equal(toSign.primaryType, "Door");
  assert.deepEqual(toSign.message, { job: "a-coat-given-the-rain", number: 10n, seat: SEAT, role: "builder", until: 1_791_000_000n });
  assert.deepEqual(toSign.domain, { name: "POD", version: "1", chainId: 10143, verifyingContract: JOBS });
  assert.match(toSign.said, /Door for POD at 0xc831/);
});

test("what the app's own verifier would check is what this signs", async () => {
  const toSign = asked() as ToSign;
  const signature = await agent.signTypedData(toSign);
  assert.equal(await recoverTypedDataAddress({ ...toSign, signature }), agent.address);
});

test("the signature cannot be read as a signed message, which is what keeps it out of an operation", async () => {
  const toSign = asked() as ToSign;
  const signature = await agent.signTypedData(toSign);
  // an operation is authorised by a plain signature over its hash; this one is over the typed hash,
  // which carries the domain, so reading it that way recovers somebody who is not the agent
  const asMessage = await recoverMessageAddress({ message: { raw: hashTypedData(toSign) }, signature });
  assert.notEqual(asMessage.toLowerCase(), agent.address.toLowerCase());
});

test("a statement for another app, contract or chain is a different signature", async () => {
  const signature = async (over: Partial<Parameters<typeof statementToSign>[0]>): Promise<Hex> =>
    agent.signTypedData(asked(over) as ToSign);
  const here = await signature({});
  for (const over of [{ app: "NOTPOD" }, { version: "2" }, { contract: SEAT as `0x${string}` }, { chainId: 1 }]) {
    assert.notEqual(await signature(over), here);
  }
});

test("a structure that is not written as EIP-712 writes it is refused, since a loose one is a different structure", () => {
  assert.match(problem({ statement: "Door(job string, number uint256)" }), /not a field/);
  assert.match(problem({ statement: "Door" }), /not a structure written as EIP-712/);
  assert.match(problem({ statement: "Door()", values: [] }), /says something/);
});

test("only plain values are signed: a list or another structure is refused rather than guessed at", () => {
  assert.match(problem({ statement: "Door(string[] jobs)", values: ["a"] }), /not a field/);
  assert.match(problem({ statement: "Door(Seat seat)", values: ["a"] }), /not a field/);
});

test("values that do not fit their field are refused in words, before anything is signed", () => {
  assert.match(problem({ values: ["a-coat", "ten", SEAT, "builder", "1"] }), /number \(uint256\) is a whole number/);
  assert.match(problem({ values: ["a-coat", "10", "not-an-address", "builder", "1"] }), /seat \(address\) is an address/);
  assert.match(problem({ values: ["a-coat", "10", SEAT, "builder"] }), /Door has 5 fields; 4 were given/);
  assert.match(problem({ statement: "Door(bool open)", values: ["yes"] }), /open \(bool\) is true or false/);
  assert.match(problem({ statement: "Door(bytes32 commit)", values: ["0xab"] }), /commit \(bytes32\) is 32 bytes/);
});
