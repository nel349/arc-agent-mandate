import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * `app.json`, passed through unchanged, plus one thing only the web build needs.
 *
 * Hosted under a path rather than at a domain's root, the web app has to know that path, or every
 * script and asset it asks for is looked up at the root and missing. Expo reads it only from the app
 * config, so it is set here from `EXPO_BASE_URL`, and only when that is given: a native build and a
 * plain web build are exactly what they were.
 *
 *   EXPO_BASE_URL=/mandate npx expo export --platform web
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = process.env["EXPO_BASE_URL"];
  return {
    ...(config as ExpoConfig),
    ...(base ? { experiments: { ...config.experiments, baseUrl: base } } : {}),
  };
};
