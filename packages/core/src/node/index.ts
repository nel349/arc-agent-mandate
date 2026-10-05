/**
 * What only a program on a machine needs: the agent's key, kept in a file only its owner can read.
 * Apart from the core, so the phone and a page never import `node:fs`.
 */
export * from "./agentKey.ts";
