/**
 * Reports which globals the dependency chain needs and the runtime lacks.
 *
 * Written after fixing five of these one crash-and-reload at a time. Each failure surfaced as
 * an unrelated-looking error deep inside Circle's SDK, so the cost was not the fix but the
 * round trip to find it. This asks the runtime everything at once instead.
 *
 * The list is not speculative — it is what a scan of viem, ox, webauthn-p256, uuid and
 * Circle's SDK actually reference.
 */

export interface RuntimeGap {
  readonly api: string;
  readonly usedBy: string;
  readonly present: boolean;
}

const CHECKS: ReadonlyArray<{ api: string; usedBy: string; probe: () => boolean }> = [
  { api: "crypto", usedBy: "everything", probe: () => typeof crypto !== "undefined" },
  { api: "crypto.getRandomValues", usedBy: "uuid, viem", probe: () => typeof crypto?.getRandomValues === "function" },
  { api: "crypto.subtle", usedBy: "webauthn-p256", probe: () => typeof (crypto as { subtle?: unknown })?.subtle === "object" },
  { api: "btoa", usedBy: "viem, ox", probe: () => typeof btoa === "function" },
  { api: "atob", usedBy: "viem, ox", probe: () => typeof atob === "function" },
  { api: "TextEncoder", usedBy: "viem, ox, webauthn-p256", probe: () => typeof TextEncoder === "function" },
  { api: "TextDecoder", usedBy: "viem, ox, webauthn-p256", probe: () => typeof TextDecoder === "function" },
  { api: "structuredClone", usedBy: "viem", probe: () => typeof structuredClone === "function" },
  { api: "AbortController", usedBy: "viem", probe: () => typeof AbortController === "function" },
  { api: "queueMicrotask", usedBy: "viem", probe: () => typeof queueMicrotask === "function" },
  { api: "fetch", usedBy: "Circle SDK, viem", probe: () => typeof fetch === "function" },
  { api: "Headers", usedBy: "our X-AppInfo rewrite", probe: () => typeof Headers === "function" },
  { api: "BigInt", usedBy: "viem, our Usdc type", probe: () => typeof BigInt === "function" },
];

/** Everything the chain needs that the runtime does not provide. Empty is the goal. */
export function auditRuntime(): RuntimeGap[] {
  return CHECKS.map(({ api, usedBy, probe }) => {
    let present = false;
    try { present = probe(); } catch { present = false; }
    return { api, usedBy, present };
  }).filter((r) => !r.present);
}

/** Logs the audit. Call after the shims install, so it reports what is still genuinely missing. */
export function logRuntimeAudit(): void {
  const gaps = auditRuntime();
  if (gaps.length === 0) {
    console.log("[arc-audit] runtime complete — every API the dependency chain needs is present");
    return;
  }
  console.warn(`[arc-audit] ${gaps.length} MISSING:`);
  for (const g of gaps) console.warn(`[arc-audit]   ${g.api}  (needed by ${g.usedBy})`);
}
