/**
 * Somewhere to remember a preference, and somewhere to fall back to when there isn't.
 *
 * `@react-native-async-storage/async-storage` is a **native** module: it has to be compiled into
 * the app binary, and importing it in a build that predates it throws at module scope. That took
 * down the whole app — the theme provider wraps the navigator, so a missing preference store
 * white-screened a wallet.
 *
 * Nothing here is worth that. The store is loaded lazily inside a guard, and when it is absent the
 * app keeps the choice in memory for the session and simply forgets it on restart. A preference
 * that does not persist is a small disappointment; a wallet that will not open is not.
 */
type Store = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/** Survives a reload, not a restart. Used only when the native store is unavailable. */
const memory = new Map<string, string>();

const inMemory: Store = {
  getItem: async (key) => memory.get(key) ?? null,
  setItem: async (key, value) => void memory.set(key, value),
};

let resolved: Store | null = null;

function store(): Store {
  if (resolved) return resolved;
  try {
    // Required rather than imported: a static import runs at module scope, where a missing native
    // module cannot be caught and takes the screen with it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage") as { default?: Store };
    resolved = mod.default ?? inMemory;
  } catch {
    console.warn(
      "[preferences] native storage unavailable — choices last for this session only. " +
        "Rebuild the dev client to persist them.",
    );
    resolved = inMemory;
  }
  return resolved;
}

export async function readPreference(key: string): Promise<string | null> {
  try {
    return await store().getItem(key);
  } catch {
    return null;
  }
}

export async function writePreference(key: string, value: string): Promise<void> {
  try {
    await store().setItem(key, value);
  } catch {
    // A preference that failed to save is not worth interrupting anyone over.
  }
}
