/**
 * Custom entry point, ahead of expo-router.
 *
 * React Native ships no Web Crypto RNG, so `crypto.getRandomValues()` is undefined. Circle's
 * SDK reaches for it (through `uuid`, for JSON-RPC ids) and viem needs it for key material, so
 * without this the very first RPC call fails with "crypto.getRandomValues() not supported".
 *
 * The polyfill must be imported before anything that touches crypto — which is why this file
 * exists at all rather than an import inside a layout, where module-level code in the import
 * graph would already have run.
 */
import "react-native-get-random-values";
import "expo-router/entry";

// Reports anything the dependency chain needs that this runtime lacks — see runtime-audit.ts.
// Cheap, and it turns a crash-and-reload hunt into one line of output.
import { installWebAuthnShim } from "./src/passkey/shim.ts";
import { logRuntimeAudit } from "./src/passkey/runtime-audit.ts";

// Shims first, then audit — otherwise the audit reports gaps the shims are about to fill.
installWebAuthnShim(process.env.EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN ?? "kuiralabs.github.io");
logRuntimeAudit();
