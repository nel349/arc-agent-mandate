import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_NAME as SHARED } from "../packages/core/src/product.ts";
import { PRODUCT_NAME } from "./product.ts";

/** The connector keeps a copy so it builds against a released core. This is what keeps it a copy. */
test("the connector calls the product what the wallet does", () => {
  assert.equal(PRODUCT_NAME, SHARED);
});
