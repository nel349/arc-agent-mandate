import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPublicClient } from "viem";
import { politeHttp, isTurnedAway } from "./polite.ts";

/** the same rule, hurried, so the suite is not spent waiting out a stand-in */
const QUICKLY = { timesAskedAgain: 4, firstWaitMs: 2, mostToWaitMs: 8 };

/**
 * A node that turns bursts away the way Monad's does, and a client that waits it out.
 *
 * Found live on 5 October: an agent read its allowance, what the allowance reaches and then signed,
 * and the node answered "requests limited to 15/sec" with a code of its own. viem does not wait that
 * out, so the agent failed in front of the person instead of pausing for a quarter of a second.
 */

/** A stand-in node: it refuses the first `refusals` requests the way Monad does, then answers. */
async function aNodeThatRefuses(refusals: number): Promise<{ readonly url: string; asked: () => number; close: () => Promise<void> }> {
  let asked = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (part: Buffer) => { body += part.toString(); });
    request.on("end", () => {
      const { id } = JSON.parse(body) as { id: number };
      asked += 1;
      const answer = asked <= refusals
        ? { jsonrpc: "2.0", id, error: { code: -32011, message: "requests limited to 15/sec" } }
        : { jsonrpc: "2.0", id, result: "0x2797" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    asked: () => asked,
    close: () => new Promise<void>((closed) => { server.close(() => closed()); }),
  };
}

test("a request turned away for coming too fast is waited on and asked again, and answers", async () => {
  const node = await aNodeThatRefuses(3);
  try {
    const client = createPublicClient({ transport: politeHttp(node.url, QUICKLY) });
    assert.equal(await client.getChainId(), 10_135, "0x2797 is what the node answered");
    assert.equal(node.asked(), 4, "it asked again until the node answered");
  } finally {
    await node.close();
  }
});

test("a node that will not stop refusing is given up on, rather than asked forever", async () => {
  const node = await aNodeThatRefuses(Number.MAX_SAFE_INTEGER);
  try {
    const client = createPublicClient({ transport: politeHttp(node.url, QUICKLY) });
    await assert.rejects(() => client.getChainId(), (error: unknown) => isTurnedAway(error));
    assert.equal(node.asked(), QUICKLY.timesAskedAgain + 1, "it asked the first time and then as many times again as it may");
  } finally {
    await node.close();
  }
});

test("anything else is passed on at once, since waiting would only hide it", async () => {
  let asked = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (part: Buffer) => { body += part.toString(); });
    request.on("end", () => {
      const { id } = JSON.parse(body) as { id: number };
      asked += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "Signer had insufficient balance" } }));
    });
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const port = (server.address() as { port: number }).port;
  try {
    const client = createPublicClient({ transport: politeHttp(`http://127.0.0.1:${port}`, QUICKLY) });
    await assert.rejects(() => client.getChainId());
    assert.equal(asked, 1, "it did not ask again");
  } finally {
    await new Promise<void>((closed) => { server.close(() => closed()); });
  }
});
