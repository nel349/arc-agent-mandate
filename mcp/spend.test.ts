import { test } from "node:test";
import assert from "node:assert/strict";
import { serially } from "./spend.ts";

/**
 * Operations from one connector go one at a time.
 *
 * Two sent together share the agent's nonce, and the second replaces the first, which is then
 * reported, two minutes later, as a refused payment it never was.
 */

/** A piece of work that finishes only when told to, recording when it starts and ends. */
function gated(name: string, log: string[]) {
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const work = async (): Promise<string> => {
    log.push(`${name} starts`);
    await done;
    log.push(`${name} ends`);
    return name;
  };
  return { work, finish };
}

test("a second operation starts only once the first has finished, in the order asked", async () => {
  const log: string[] = [];
  const inLine = serially();
  const first = gated("first", log);
  const second = gated("second", log);

  const firstDone = inLine(first.work);
  const secondDone = inLine(second.work);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(log, ["first starts"], "the second began while the first was still out");

  first.finish();
  second.finish();
  assert.equal(await firstDone, "first");
  assert.equal(await secondDone, "second");
  assert.deepEqual(log, ["first starts", "first ends", "second starts", "second ends"]);
});

test("a failed operation does not hold up the next one, and still fails for its own caller", async () => {
  const inLine = serially();
  const failing = inLine(async () => { throw new Error("the bundler said no"); });
  const after = inLine(async () => "sent");

  await assert.rejects(failing, /the bundler said no/);
  assert.equal(await after, "sent");
});
