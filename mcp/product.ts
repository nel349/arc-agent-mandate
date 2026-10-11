/**
 * What the product is called, as the connector says it.
 *
 * The name's one home is `PRODUCT_NAME` in `@kuiralabs/mandate-core`, and a test beside this file
 * fails if the two differ. It is repeated here, and not imported, because the connector is published
 * against a released core: importing a name that the released core does not have yet built a
 * connector that would not start. When a core that exports it has been released and this package
 * depends on that release, this file can become one line that passes it on.
 */
export const PRODUCT_NAME = "Mandate";
