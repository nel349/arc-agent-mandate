import { PRODUCT_NAME } from "@kuiralabs/mandate-core";

/**
 * The product's name, as the wallet shows it. Kept in the package the wallet and the connector
 * share, so the two cannot come to call it different things again.
 */
export { PRODUCT_NAME };

/** The name as a mark: lower case, beside the ring. */
export const WORDMARK = PRODUCT_NAME.toLowerCase();
