/**
 * Reading an agent's code, from the camera or from the paste field.
 *
 * The rule lives in the core package, `@kuiralabs/mandate-core`, because the phone and the agent have to
 * read the same link and compute the same tag from it, and one definition is how they cannot drift.
 * It stays pure and apart from the screen so the parsing can be tested without a camera, which
 * matters here: the only way to exercise it on a device is to point a phone at a laptop.
 */
export { readPairingLink, type ScannedAgent } from "@kuiralabs/mandate-core";
