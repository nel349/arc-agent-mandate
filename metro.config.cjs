// .cjs, not .js: package.json sets "type": "module" so that `node --test` can run our
// TypeScript directly, but Metro's config is CommonJS. The extension is what keeps both true.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

// `web3` is a 11.4 MB dependency of Circle's SDK, imported for one error class. Alias it to a
// stub rather than bundle it. See src/stubs/web3.ts for why this is safe and how it fails.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  web3: path.resolve(__dirname, "src/stubs/web3.ts"),
};

// The core package is read from its source inside the repository, as the typechecker and the tests read
// it: its "mandate-source" export points at the .ts, so nothing has to be built before the app bundles.
config.resolver.unstable_conditionNames = [...(config.resolver.unstable_conditionNames ?? []), "mandate-source"];

module.exports = config;
