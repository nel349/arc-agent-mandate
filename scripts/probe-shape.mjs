// What does OUR native module actually receive, after Circle's SDK adapts the RP options?
import "dotenv/config";
let seen = null;
// Node makes globalThis.navigator getter-only, so build a standalone window object.
Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {
  location: { hostname: "kuiralabs.github.io", protocol: "https:" },
  navigator: { credentials: {
    create: async (o) => { seen = o.publicKey; throw new Error("STOP"); },
    get: async () => { throw new Error("STOP"); },
  }},
}});
const { toPasskeyTransport, toWebAuthnCredential, WebAuthnMode } =
  await import("@circle-fin/modular-wallets-core");
try {
  await toWebAuthnCredential({
    transport: toPasskeyTransport(process.env.CIRCLE_CLIENT_URL, process.env.CIRCLE_CLIENT_KEY),
    username: `shape-${Date.now()}`,
    mode: WebAuthnMode.Register,
  });
} catch {}
const t = (v) => v?.constructor?.name + (v?.length !== undefined ? `(${v.length})` : "");
console.log("what our Expo module receives:");
console.log("  challenge   :", t(seen?.challenge));
console.log("  user.id     :", t(seen?.user?.id));
console.log("  rp          :", JSON.stringify(seen?.rp));
console.log("  authSel     :", JSON.stringify(seen?.authenticatorSelection));
console.log("  pubKeyParams:", JSON.stringify(seen?.pubKeyCredParams));
