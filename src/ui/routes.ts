import type { Activity } from "../arc/activity.ts";

/**
 * Where each screen lives, named once.
 *
 * Route strings were written out at every call site, and the receipt's two parameters — `tx` and
 * `log` — were spelled by hand at three of them. A mistyped route is not a type error and not a
 * crash: it is a tap that does nothing, found by somebody using the app. The maze keeps its own
 * addresses this way in `src/paths.ts`, for the same reason.
 *
 * Pure, so it is testable, and so a screen imports a function rather than remembering a shape.
 */

export const ROUTES = {
  allowances: "/",
  rewards: "/rewards",
  /** Before there is a wallet, and outside the tabs: see `app/welcome.tsx`. */
  welcome: "/welcome",
  /** A site asking to know this wallet: see `app/connect.tsx`. */
  connect: "/connect",
  grant: "/grant",
  activity: "/activity",
  settings: "/settings",
  /** Reached from Settings only, and only by somebody looking for them. */
  dev: "/dev",
  preview: "/preview",
} as const;

/**
 * One agent's own screen.
 *
 * The return type keeps the `/agent/…` shape rather than widening to `string`, so a route built here
 * is still the pattern the router matches on and not merely some text that happens to be a path.
 */
export const agentRoute = (agent: string): `/agent/${string}` => `/agent/${agent}`;

/**
 * One row's receipt. The row is identified by its log, which is what the feed keys rows by, so the
 * screen can find it again in what has already been read rather than asking the chain.
 */
export const receiptRoute = (item: Pick<Activity, "tx" | "logIndex" | "call">) => ({
  pathname: "/receipt" as const,
  // and its call, where one operation paid several people and each is its own row
  params: { tx: item.tx, log: String(item.logIndex), ...(item.call === undefined ? {} : { call: String(item.call) }) },
});

/** Whether a row is the one a receipt was opened for, from the route's own parameters. */
export const isReceiptFor = (item: Pick<Activity, "tx" | "logIndex" | "call">, params: { readonly tx?: string; readonly log?: string; readonly call?: string }): boolean =>
  item.tx === params.tx && String(item.logIndex) === params.log && (item.call === undefined ? params.call === undefined : String(item.call) === params.call);

/** Everything an agent did, or everything every agent did when no agent is named. */
export const activityRoute = (agent?: string) =>
  agent === undefined
    ? { pathname: ROUTES.activity }
    : { pathname: ROUTES.activity, params: { agent } };
