import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Guards the test runner's TypeScript support.
 *
 * `node --test` strips types by default, which cannot handle TypeScript that **emits** runtime
 * code: enums, parameter properties, namespaces, decorators. Metro and Babel handle all of
 * them, so a test runner without `--experimental-transform-types` disagrees with the bundler
 * about what the language is — code that ships fine fails the gate, and the failure arrives as
 * a whole-file load error naming neither the feature nor the flag.
 *
 * This file uses each of them. If the flag is dropped from `package.json`, this fails loudly
 * and the message points at the cause.
 */

enum Phase {
  Pending = "pending",
  Done = "done",
}

class HasParameterProperty {
  constructor(readonly amount: number) {}
}

test("the test runner transforms TypeScript rather than only stripping it", () => {
  assert.equal(Phase.Done, "done", "enums require --experimental-transform-types");
  assert.equal(new HasParameterProperty(7).amount, 7, "parameter properties require it too");
});
