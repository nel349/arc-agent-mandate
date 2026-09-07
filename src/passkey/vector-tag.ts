/**
 * The marker that joins a device run to a saved fixture.
 *
 * Alone in its own module because it is the one piece three parties share — the app that prints
 * it, `scripts/save-vector.ts` that greps for it, and the test that checks those two still
 * agree. Kept out of `vector-capture.ts` because that file imports `react-native`, which Node
 * cannot parse; a test reaching for the constant would drag Flow syntax into the runner.
 */
export const VECTOR_TAG = "ARC_PASSKEY_VECTOR";
