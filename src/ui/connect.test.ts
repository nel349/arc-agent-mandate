import { test } from "node:test";
import assert from "node:assert/strict";
import { connectedUrl, readConnectedSite, readConnectRequest } from "./connect.ts";

const WALLET = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";

test("a web page asking to connect is shown by its host, and gets the address added to its return", () => {
  const r = readConnectRequest("http://mb-mamalon.tailba5c66.ts.net:8975/#connected/");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.host, "mb-mamalon.tailba5c66.ts.net:8975");
  assert.equal(connectedUrl(r, WALLET), `http://mb-mamalon.tailba5c66.ts.net:8975/#connected/${WALLET}`);
});

/** The address is the owner's to give: only to a page they can see, never to another kind of link. */
test("only a web page may receive the address", () => {
  for (const sneaky of ["javascript:alert(1)//", "file:///etc/passwd", "intent://x#Intent;end", "ftp://x/"]) {
    assert.equal(readConnectRequest(sneaky).ok, false, sneaky);
  }
});

test("nothing to return to, or nonsense, is said plainly rather than sent anywhere", () => {
  assert.match((readConnectRequest(undefined) as { problem: string }).problem, /Nothing asked to connect/);
  assert.match((readConnectRequest("not a url") as { problem: string }).problem, /cannot read/);
});

test("the site kept after connecting is read back only while it is still a web page", () => {
  assert.deepEqual(readConnectedSite("http://bench.test:8975/#connected/"), { url: "http://bench.test:8975/#connected/", host: "bench.test:8975" });
  assert.equal(readConnectedSite(null), null);
  assert.equal(readConnectedSite("javascript:alert(1)"), null);
});

