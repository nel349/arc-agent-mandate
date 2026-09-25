#!/usr/bin/env node
/**
 * Builds the app for the web, under a path, from a commit, and optionally publishes it into a site.
 *
 *   npm run web:export                                   # into dist-web/, for a look
 *   npm run web:export -- --to ../kuiralabs.github.io    # into that site's mandate/ folder
 *
 * Three things a bare `expo export` does not do, each learned by publishing without it:
 *
 * - **It says what it was built from.** `BUILD.json` names the commit, and a working tree with
 *   changes is refused, so what a site serves always matches something that can be read.
 * - **It lives under a path.** `EXPO_BASE_URL` (see `app.config.ts`) defaults to `/mandate`, so every
 *   script and asset is asked for under it.
 * - **A reload on an inner screen works.** GitHub Pages answers any missing file with the site's
 *   `404.html`, so that page starts the app for any address under the path, and says "Not found"
 *   for any other address on the domain. It is the site's only 404 page, so it serves the whole
 *   domain; anything else on it that wants its own must share this one.
 *
 * The client key and passkey domain are the `EXPO_PUBLIC_` values in `.env`, which Expo writes into
 * the bundle. That is by design (see `.env.example`); nothing secret belongs in those.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const base = process.env.EXPO_BASE_URL ?? "/mandate";
const toIndex = process.argv.indexOf("--to");
const site = toIndex === -1 ? null : resolve(process.argv[toIndex + 1] ?? "");
const out = resolve("dist-web");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git("status", "--porcelain") !== "") {
  console.error("The working tree has changes. Commit them first, so the build matches a commit.");
  process.exit(1);
}
const commit = git("rev-parse", "HEAD");

rmSync(out, { recursive: true, force: true });
execFileSync("npx", ["expo", "export", "--platform", "web", "--output-dir", out], {
  stdio: "inherit", env: { ...process.env, EXPO_BASE_URL: base },
});
writeFileSync(join(out, "BUILD.json"), `${JSON.stringify({ commit, base, built: new Date().toISOString() }, null, 2)}\n`);
console.log(`\nBuilt ${commit.slice(0, 7)} under ${base} into ${out}`);

if (site) {
  if (!existsSync(join(site, ".git"))) {
    console.error(`${site} is not a site checkout.`);
    process.exit(1);
  }
  const into = join(site, base.replace(/^\//, ""));
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  cpSync(out, into, { recursive: true });
  writeFileSync(join(site, "404.html"), notFoundPage(readFileSync(join(out, "index.html"), "utf8")));
  console.log(`Copied into ${into}, and wrote ${join(site, "404.html")}.`);
  console.log(`Commit the site with the source commit in the message: ${commit.slice(0, 7)}.`);
}

/**
 * The app's own page, with its scripts started only for an address under the path.
 *
 * The scripts are taken out of the page and added back in order by a few lines that check the
 * address first; `async = false` keeps them running in the order the page listed them.
 */
function notFoundPage(index) {
  const scripts = [...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
  const withoutScripts = index.replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/g, "");
  const loader = `<script>
(function () {
  var base = ${JSON.stringify(base)};
  var path = location.pathname;
  if (path === base || path.indexOf(base + "/") === 0) {
    ${JSON.stringify(scripts)}.forEach(function (src) {
      var s = document.createElement("script");
      s.src = src; s.async = false;
      document.body.appendChild(s);
    });
  } else {
    document.title = "Not found";
    document.body.textContent = "Not found";
  }
})();
</script>`;
  return withoutScripts.replace("</body>", `${loader}\n</body>`);
}
