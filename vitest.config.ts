/** `vitest/config` rather than `vite`, so the test block is typed rather than ignored. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

const ROOT = dirname(fileURLToPath(import.meta.url));
const here = (path: string): string => join(ROOT, path);

/**
 * Expo's packages ship JSX inside `.js` files, which Metro reads and Vite, by default, does not. Read
 * as JSX here, before anything else sees them. Plain JavaScript reads the same as JSX.
 */
const EXPO_JSX = /node_modules\/(@expo\/[^/]+|expo-[^/]+|react-native-[^/]+)\/.*\.js(\?.*)?$/;
const jsxInExpoPackages: Plugin = {
  name: "jsx-in-expo-packages",
  enforce: "pre",
  async transform(code, id) {
    if (!EXPO_JSX.test(id)) return null;
    const read = await transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
    return { code: read.code, map: JSON.stringify(read.map) };
  },
};

/**
 * Components drawn and tapped, as Bench tests its page.
 *
 * Through react-native-web, which is what the published wallet runs on: the page people open is
 * this same code drawn by react-native-web, so a component tested here is the component they tap.
 * It does not draw the iOS build. The logic tests stay on `node:test` (`npm test`); this is
 * `npm run test:components`, and `.tsx` tests only, so neither runner picks up the other's files.
 */
export default defineConfig({
  plugins: [jsxInExpoPackages],
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: "@passkey-native", replacement: here("./modules/arc-passkey/src/index.ts") },
      { find: /^@\/(.*)$/, replacement: `${here("src")}/$1` },
    ],
    // A file made for the web is preferred where a package ships one, as Metro does for the web build.
    extensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".mjs", ".js", ".jsx", ".json"],
    // Inside the repository the core package is read from its source, never from a build.
    conditions: ["mandate-source", "browser", "module", "import", "default"],
    // A package's ES build before its CommonJS one, as the web bundle reads it, so `.web.js` files are found.
    mainFields: ["browser", "module", "main"],
  },
  esbuild: { jsx: "automatic" },
  define: { __DEV__: "true", "process.env.EXPO_OS": JSON.stringify("web") },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    // A browser global a test stands in for is put back after it, pass or fail.
    unstubGlobals: true,
    // Packages that import `react-native` themselves go through the same alias, or Node would load
    // React Native's own source, which is Flow, not JavaScript.
    server: { deps: { inline: [/react-native/, /@expo\//, /expo-/] } },
    // Node 25 has a `localStorage` of its own, empty and unusable without a file, and it hides the
    // page's. The wallet's preferences live in the page's, as they do in a browser.
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] } },
    // expo-router ships CommonJS with JSX in it, which Node cannot load. Pre-bundled the way a browser
    // build reads it, through the same aliases, so a screen and its `Redirect` are drawn for real.
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: ["expo-router"],
          esbuildOptions: {
            loader: { ".js": "jsx" },
            jsx: "automatic",
            resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".mjs", ".js", ".jsx", ".json"],
            define: { __DEV__: "true", "process.env.EXPO_OS": JSON.stringify("web") },
          },
        },
      },
    },
  },
});
