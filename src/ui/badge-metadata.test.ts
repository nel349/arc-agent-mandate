import { test } from "node:test";
import assert from "node:assert/strict";
import { readBadgeMetadata, svgFromDataUri } from "./badge-metadata.ts";

/**
 * Reading a badge's own description, in the shape the maze really serves it.
 *
 * The `image` below is the head of what `https://arc-maze.vercel.app/badge/1` answers today: the
 * whole picture, base64, inside a data URI. `integration/badges.test.ts` fetches the live one, so
 * these can stay small and exact.
 */

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="100" height="100"/></svg>';
const asBase64 = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

test("the picture is the SVG inside the data URI, however it was encoded", () => {
  assert.equal(svgFromDataUri(asBase64), svg);
  assert.equal(svgFromDataUri(`data:image/svg+xml,${encodeURIComponent(svg)}`), svg);
});

test("anything that is not a picture this phone can draw reads as none, never as a crash", () => {
  assert.equal(svgFromDataUri("https://example.test/badge.png"), null);
  assert.equal(svgFromDataUri("data:image/svg+xml;base64,not base64 at all"), null);
  assert.equal(svgFromDataUri("data:image/svg+xml;base64,"), null, "empty is not a picture");
  assert.equal(svgFromDataUri(`data:image/svg+xml;base64,${Buffer.from("nope", "utf8").toString("base64")}`), null);
});

test("a badge's metadata gives its name and its picture", () => {
  assert.deepEqual(readBadgeMetadata({ name: "Cohort Zero #1", image: asBase64 }), {
    name: "Cohort Zero #1",
    svg,
  });
});

test("metadata with no picture still names the badge, and a body that is not metadata is nothing", () => {
  assert.deepEqual(readBadgeMetadata({ name: "Cohort Zero #1" }), { name: "Cohort Zero #1", svg: null });
  assert.deepEqual(
    readBadgeMetadata({ name: "Cohort Zero #1", image: "ipfs://somewhere" }),
    { name: "Cohort Zero #1", svg: null },
  );
  assert.equal(readBadgeMetadata({ image: asBase64 }), null, "a badge with no name is not metadata");
  assert.equal(readBadgeMetadata("a string"), null);
  assert.equal(readBadgeMetadata(null), null);
});
