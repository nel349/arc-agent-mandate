#!/usr/bin/env node
/**
 * Print the connector's install configuration, filled in for this checkout.
 *
 *   node scripts/print-mcp-config.mjs            # shape only, safe to paste anywhere
 *   node scripts/print-mcp-config.mjs --secrets  # filled from .env, writes to a file
 *
 * The absolute path matters — an MCP client launches the server itself and does not inherit a
 * working directory — so a config copied from a README is wrong on every machine but the author's.
 *
 * By default the client key is left as a placeholder. It is not much of a secret (the mobile app
 * ships it, and it authorises nothing on its own), but a key pasted into a chat window is a key
 * in someone's scrollback forever, so `--secrets` writes to a file instead of stdout.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const withSecrets = process.argv.includes("--secrets");
/** `claude mcp add-json` wants the server entry alone, not the `mcpServers` wrapper around it. */
const entryOnly = process.argv.includes("--entry");

const env = (() => {
  try {
    return Object.fromEntries(
      readFileSync(join(root, ".env"), "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
})();

const pick = (...names) => names.map((n) => env[n]).find(Boolean);
const placeholder = (value, hint) => (withSecrets && value ? value : hint);

const config = {
  mcpServers: {
    "arc-mandate": {
      command: "node",
      args: [join(root, "mcp", "server.mjs")],
      env: {
        CIRCLE_CLIENT_URL: placeholder(
          pick("CIRCLE_CLIENT_URL", "EXPO_PUBLIC_CIRCLE_CLIENT_URL"),
          "https://modular-sdk.circle.com/v1/rpc/w3s/buidl",
        ),
        CIRCLE_CLIENT_KEY: placeholder(
          pick("CIRCLE_CLIENT_KEY", "EXPO_PUBLIC_CIRCLE_CLIENT_KEY"),
          "TEST_CLIENT_KEY:…",
        ),
        CIRCLE_PASSKEY_DOMAIN: placeholder(
          pick("CIRCLE_PASSKEY_DOMAIN", "EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN"),
          "your-passkey-domain.example",
        ),
      },
    },
  },
};

const json = `${JSON.stringify(entryOnly ? config.mcpServers["arc-mandate"] : config, null, 2)}\n`;

if (entryOnly) {
  // Straight to stdout so it can be substituted into a command.
  process.stdout.write(json);
} else if (withSecrets) {
  const out = join(root, "mcp-config.local.json");
  writeFileSync(out, json, { mode: 0o600 });
  console.log(`Written to ${out} (gitignored, owner-only).`);
  console.log("\nClaude Desktop — merge the mcpServers entry into:");
  console.log("  ~/Library/Application Support/Claude/claude_desktop_config.json\n");
  console.log("Claude Code — from this directory:");
  console.log("  claude mcp add-json arc-mandate \"$(node scripts/print-mcp-config.mjs --entry --secrets)\"");
  console.log("\nEither way, restart the client: an MCP server is launched at startup.");
} else {
  process.stdout.write(json);
}
