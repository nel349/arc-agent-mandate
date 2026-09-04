/**
 * Talks to Circle's relying party with a real client key — no device, no ceremony.
 *
 * This is the cheapest way to learn three things W1 depends on:
 *   1. whether the key works at all,
 *   2. what `rpId` Circle issues (which is the passkey domain our app must bind to),
 *   3. the exact shape of the registration options our native module will receive.
 */
import "dotenv/config";

// React Native aliases `window` to `globalThis`; Node does not, and Circle's SDK reaches for it
// even on plain RP calls. This is the same thing `installWebAuthnShim()` does in the app — so
// needing it here is a small confirmation that the shim is doing the right thing.
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

// Circle derives its X-AppInfo identity from `window?.location?.hostname || "unknown"`, and a
// domain-bound client key is validated against it. Neither Node nor React Native has a
// `location`, so without this every call is sent as uri=unknown and rejected.
globalThis.window.location ??= { hostname: process.env.CIRCLE_PASSKEY_DOMAIN ?? "kuiralabs.github.io", protocol: "https:" };
import { toPasskeyTransport, createRpClient, rpActions } from "@circle-fin/modular-wallets-core";

const clientKey = process.env.CIRCLE_CLIENT_KEY;
const clientUrl = process.env.CIRCLE_CLIENT_URL;
if (!clientKey || !clientUrl) throw new Error("CIRCLE_CLIENT_KEY and CIRCLE_CLIENT_URL must be set");

const transport = toPasskeyTransport(clientUrl, clientKey);
const rp = createRpClient({ transport }).extend(rpActions);

const username = `arc-probe-${Date.now()}`;
console.log(`requesting registration options for "${username}" …\n`);

try {
  const options = await rp.getRegistrationOptions({ username });
  console.log("KEY WORKS. registration options:\n");
  console.log(JSON.stringify(options, (_k, v) =>
    v instanceof Uint8Array ? `<Uint8Array ${v.length}b>` : v, 2));
  console.log("\n--- the fields that decide our config ---");
  console.log("  rp.id       :", options?.rp?.id, "  <-- the passkey domain the app must bind to");
  console.log("  rp.name     :", options?.rp?.name);
  console.log("  user.id     :", options?.user?.id?.constructor?.name, options?.user?.id?.length ?? "");
  console.log("  challenge   :", options?.challenge?.constructor?.name, options?.challenge?.length ?? "");
  console.log("  algorithms  :", options?.pubKeyCredParams?.map((p) => p.alg).join(", "));
  console.log("  attestation :", options?.attestation);
  console.log("  authSel     :", JSON.stringify(options?.authenticatorSelection));
} catch (e) {
  console.log("FAILED:", e?.message ?? e);
  if (e?.cause) console.log("cause :", e.cause?.message ?? e.cause);
  if (e?.details) console.log("details:", e.details);
}
