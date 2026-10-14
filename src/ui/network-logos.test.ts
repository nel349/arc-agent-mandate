import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET, NETWORKS } from "@kuiralabs/mandate-core";
import { ARC_LOGO, logoOf, MONAD_LOGO } from "./network-logos.ts";

const NETWORKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../assets/networks");
const published = (name: string): string => readFileSync(join(NETWORKS_DIR, name), "utf8");

test("each logo is drawn from its owner's file exactly as published", () => {
  assert.equal(ARC_LOGO, published("arc.svg"));
  assert.equal(MONAD_LOGO, published("monad.svg"));
});

test("every network the wallet knows has its logo, and both Arcs share Arc's", () => {
  for (const network of NETWORKS) assert.notEqual(logoOf(network), null, network.name);
  assert.equal(logoOf(ARC_TESTNET), ARC_LOGO);
  assert.equal(logoOf(ARC_MAINNET), ARC_LOGO);
  assert.equal(logoOf(MONAD_TESTNET), MONAD_LOGO);
});
