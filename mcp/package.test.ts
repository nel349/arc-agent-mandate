import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * The connector as npm ships it, not as the checkout runs it.
 *
 * A checkout runs the TypeScript directly; the package is the compiled JavaScript in `dist/`, the
 * only thing `files` publishes. The two can part ways without any other test noticing: an import
 * reaching outside `mcp/`, a type only the app's looser config accepts, or `bin` naming a file the
 * build no longer writes. Each would pass every test here and fail on a stranger's first install.
 *
 * So the package is built the way `npm pack` builds it and started the way an MCP client starts it,
 * with its key and memory in a scratch directory and nothing configured.
 */

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "package.json"), "utf8")) as {
  readonly version: string;
  readonly bin: Readonly<Record<string, string>>;
  readonly files: readonly string[];
};
const TOOLS = ["buy", "call", "check_allowance", "get_pairing_address", "pay", "sign_statement", "top_up"];

test("the published build starts, and offers every tool", async () => {
  // the core first, as publishing has to: the published connector imports the published core
  execFileSync(join(here, "..", "node_modules", ".bin", "tsc"), ["-p", join(here, "..", "packages", "core", "tsconfig.build.json")]);
  execFileSync(join(here, "..", "node_modules", ".bin", "tsc"), ["-p", join(here, "tsconfig.build.json")]);

  const entry = manifest.bin["arc-mandate"];
  assert.ok(entry !== undefined, "the package names no command");
  assert.ok(existsSync(join(here, entry)), `bin points at ${entry}, which the build did not write`);
  assert.ok(manifest.files.some((f) => entry.startsWith(`${f}/`)), `${entry} is not among the files published`);
  assert.match(readFileSync(join(here, entry), "utf8"), /^#!\/usr\/bin\/env node\n/, "the command cannot run as a program");

  const scratch = mkdtempSync(join(tmpdir(), "arc-mandate-package-"));
  const client = new Client({ name: "package-test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(here, entry)],
    env: {
      PATH: process.env.PATH ?? "",
      HOME: scratch,
      ARC_MANDATE_KEY_PATH: join(scratch, "agent.key"),
      ARC_MANDATE_ACCOUNT_PATH: join(scratch, "accounts.json"),
    },
    stderr: "ignore",
  }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS);
    // Written in two places, the manifest and the server's own hello, and they must say the same.
    assert.equal(client.getServerVersion()?.version, manifest.version, "the server reports another version than the package");
  } finally {
    await client.close();
  }
});
