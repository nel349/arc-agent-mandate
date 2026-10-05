import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, parseAbi } from "viem";
import { encodeCall } from "./call.ts";

/** POD's own functions, as its code names them: what a wallet's agent calls to take a seat and approve. */
const TAKE_SEAT = "takeSeat(uint256,uint8,address)";
const APPROVE = "approve(uint256,uint8,bytes32)";
const OWNER = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
const HASH = `0x${"ab".repeat(32)}`;

test("a call is made into exactly the data the contract decodes, every argument in its type", () => {
  const seat = encodeCall(TAKE_SEAT, ["12", "2", OWNER.toLowerCase()]);
  assert.ok("data" in seat);
  assert.equal(seat.name, "takeSeat");
  assert.deepEqual(decodeFunctionData({ abi: parseAbi([`function ${TAKE_SEAT}`]), data: seat.data }).args, [12n, 2, OWNER]);
  const approve = encodeCall(APPROVE, ["12", "2", HASH]);
  assert.ok("data" in approve);
  assert.deepEqual(decodeFunctionData({ abi: parseAbi([`function ${APPROVE}`]), data: approve.data }).args, [12n, 2, HASH]);
});

test("a function not written exactly is refused, since a loose one would be a different function", () => {
  assert.match(String((encodeCall("takeSeat(uint,uint8,address)", ["1", "2", OWNER]) as { problem: string }).problem), /not a function written exactly/);
});

test("arguments that do not read are refused in words, before anything is sent", () => {
  const problem = (args: string[], signature = TAKE_SEAT) => (encodeCall(signature, args) as { problem?: string }).problem ?? "";
  assert.match(problem(["12", "2"]), /takeSeat takes 3 arguments; 2 were given/);
  assert.match(problem(["twelve", "2", OWNER]), /Argument 1 \(uint256\) is a whole number/);
  assert.match(problem(["-1", "2", OWNER]), /Argument 1 \(uint256\) is a whole number/);
  assert.match(problem(["12", "2", "0xnope"]), /Argument 3 \(address\) is an address/);
  assert.match(problem(["12", "2", "0xabcd"], APPROVE), /Argument 3 \(bytes32\) is 32 bytes/);
  assert.match(problem(["1"], "f(uint256[])"), /only plain values/);
});
