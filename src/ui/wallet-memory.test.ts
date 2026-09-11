import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSameWallet, launchPlan, parseWalletMemory, serializeWalletMemory, walletMemoryOf, type WalletMemory,
} from "./wallet-memory.ts";

const ADDRESS = "0xEe1933BbBC8acd7B32caD469D4f22Ca5B19d7918";
/** A compressed P-256 public key's shape: 33 bytes. */
const PUBLIC_KEY = `0x02${"ab".repeat(32)}` as const;
const CREDENTIAL_ID = "kJ3x_Zq-9fA";

const MEMORY: WalletMemory = { credentialId: CREDENTIAL_ID, publicKey: PUBLIC_KEY, address: ADDRESS };

test("a remembered wallet reads back as it was written", () => {
  assert.deepEqual(parseWalletMemory(serializeWalletMemory(MEMORY)), MEMORY);
});

test("the remembered part of an account is its public half and nothing else", () => {
  const remembered = walletMemoryOf({ address: ADDRESS, credential: { id: CREDENTIAL_ID, publicKey: PUBLIC_KEY } });
  assert.deepEqual(remembered, MEMORY);
  assert.deepEqual(Object.keys(JSON.parse(serializeWalletMemory(remembered))).sort(), ["address", "credentialId", "publicKey"]);
});

test("nothing stored, a cleared value, or something unreadable is no memory", () => {
  assert.equal(parseWalletMemory(null), null);
  assert.equal(parseWalletMemory(""), null);
  assert.equal(parseWalletMemory("{not json"), null);
  assert.equal(parseWalletMemory("[1,2,3]"), null);
  assert.equal(parseWalletMemory("\"a string\""), null);
});

test("a value that is not exactly a credential, a public key and an address is refused", () => {
  const wrong = (patch: Record<string, unknown>) => parseWalletMemory(JSON.stringify({ ...MEMORY, ...patch }));
  assert.equal(wrong({ credentialId: 7 }), null);
  assert.equal(wrong({ credentialId: "not base64url!" }), null);
  assert.equal(wrong({ publicKey: "02abab" }), null, "no 0x");
  assert.equal(wrong({ publicKey: "0x02abab" }), null, "too short to be a P-256 key");
  assert.equal(wrong({ publicKey: `0x02${"zz".repeat(32)}` }), null, "not hex");
  assert.equal(wrong({ address: "0x1234" }), null);
  assert.equal(wrong({ address: undefined }), null);
});

test("a reopened wallet is the same one whatever the case of its address", () => {
  assert.equal(isSameWallet(MEMORY, ADDRESS.toLowerCase() as `0x${string}`), true);
  assert.equal(isSameWallet(MEMORY, "0xc3BB7bc7E375f7ffA34E652F560Dc802F7A76cFa"), false);
});

test("a remembered wallet reopens, whatever else is true", () => {
  assert.equal(launchPlan({ memory: MEMORY, signedOutOnPurpose: false, canOfferPasskey: true }), "reopen");
  assert.equal(launchPlan({ memory: MEMORY, signedOutOnPurpose: true, canOfferPasskey: false }), "reopen");
});

test("with nothing remembered, the returning-user passkey is offered when the phone can", () => {
  assert.equal(launchPlan({ memory: null, signedOutOnPurpose: false, canOfferPasskey: true }), "offer-passkey");
  assert.equal(launchPlan({ memory: null, signedOutOnPurpose: false, canOfferPasskey: false }), "welcome");
});

test("after signing out on purpose, the app does not walk the person straight back in", () => {
  assert.equal(launchPlan({ memory: null, signedOutOnPurpose: true, canOfferPasskey: true }), "welcome");
});
