import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the connector keeps the agent's key: the same file it always has, so no agent's address moves.
 * `ARC_MANDATE_KEY_PATH` names another, for a second agent on one machine, or a test.
 */
export const agentKeyPath = (): string => process.env.ARC_MANDATE_KEY_PATH ?? join(homedir(), ".arc-mandate", "agent.key");
