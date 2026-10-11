/**
 * What the product is called, written once, for the wallet and anything else that says it. The
 * connector keeps a copy that a test holds to this one, until it can depend on a release that has it.
 *
 * It was "Arc Agent Mandate" in the app's config, "Agent Mandate" in what the connector tells an
 * agent to say, and "Arc Mandate" in the wallet's own notices, which is what happens to a name that
 * is typed wherever it is needed. It runs on more than Arc, so no chain is in it.
 */
export const PRODUCT_NAME = "Mandate";
