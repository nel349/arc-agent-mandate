# Run it yourself

Everything here is on **Arc testnet** and nothing in it is simulated. The allowance rules are
deployed at `0x669Dd1eDb85ABD00f74186d88124614EE81E6670`; the money is test USDC, and the refusals
are real.

Two repositories are involved. This one is the **wallet and the agent's connector** — the buyer.
[`arc-maze`](https://github.com/nel349/arc-maze) is a paid maze on Arc — something to buy *from*.
You can stop after step 5 and have seen the whole claim; steps 6 and 7 are the fun half.

## Before you start

| | |
|---|---|
| Node | 22.18 or newer (or 23.6+, or any 24) — everything here runs TypeScript directly, and unflagged type stripping starts there. 22.6 has it behind a flag, which is not enough for `node mcp/server.ts`. **Nothing enforces this**: there is no `engines` field and no `.nvmrc`, so an older Node fails at the first `node --experimental-transform-types` rather than at install |
| git | the contract suite is five git submodules under `contracts/lib`, fetched by `npm install` |
| Foundry | required by **`npm test`, not only the gate**: the unit suite shells out to `forge`, and `npm run test:integration` also needs `anvil` and `forge script`. Install from [getfoundry.sh](https://getfoundry.sh) |
| Xcode + CocoaPods, and an iPhone or simulator | passkeys need a real Secure Enclave or a simulator with one, and **Expo Go cannot do passkeys at all** — a dev build is required. `npm run ios` generates the whole `ios/` project and runs `pod install` on first use — see below |
| Bun | only to run [`arc-maze`](https://github.com/nel349/arc-maze) yourself |
| A Circle client key | free, from [console.circle.com](https://console.circle.com) → Wallets → Modular Wallets → Client Keys |
| Network access | the contract and integration suites fork live Arc, and one test calls Circle's live facilitator. None of the gate runs offline |

Android works and `npm run android` builds it, but this walk-through is written for iOS. It needs
the Android SDK and a JDK, which are not in this table because nothing here has been checked against
a clean Android toolchain.

### A note on the native projects

`ios/` and `android/` are **generated and gitignored** — `git ls-files` returns nothing for either.
`npm run ios` creates the iOS project on first run, which takes several minutes and needs CocoaPods.
Two things follow that are easy to lose an afternoon to: editing anything under `ios/` is futile,
because the next prebuild overwrites it; and `npm start` on a clean clone fails, because it is
`expo start --dev-client` and there is no dev build to attach to yet. Run `npm run ios` first.

The client key is **bound to a domain**. Use the same passkey domain the app is configured with, or
Circle refuses it with `Invalid credentials` and nothing explains why.

## 1. Configure

```bash
cp .env.example .env
```

`.env.example` ships eight names. Three are what the **app** carries, and they are public by design
— Expo inlines them into the bundle — so they are not secrets, but they do have to be right:

```
EXPO_PUBLIC_CIRCLE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
EXPO_PUBLIC_CIRCLE_CLIENT_KEY=TEST_CLIENT_KEY:…
EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN=your-passkey-domain
```

Three more are the same Circle credentials without the prefix, read by the **connector** in `mcp/`,
which runs under Node and never sees an `EXPO_PUBLIC_` variable:

```
CIRCLE_CLIENT_URL=…      CIRCLE_CLIENT_KEY=…      CIRCLE_PASSKEY_DOMAIN=…
```

The last two are optional endpoints, and worth setting before you run the gate rather than after:

```
ARC_TESTNET_RPC_URL=…              # Node only: the tests, the forks, the connector, the scripts
EXPO_PUBLIC_ALCHEMY_ARC_TESTNET=…  # carried by the app; inlined into the bundle, so treat it as published
```

With neither set everything uses Arc's public endpoint and works — but that endpoint rate-limits,
and it is the reason for the `429`s in step 2. `ARC_TESTNET_RPC_URL` is what removes them.

### Pointing it at your own Circle account and domain

The steps above assume the domain this repository is already configured with. Using your own means
five separate places, and missing any one of them fails with `Invalid credentials` — a message that
names none of them.

**Do these in order, because the relying party is Circle's and not yours.**
`getRegistrationOptions` returns the `rpId`; the app does not choose it. So Circle Console comes
first, and the Associated Domains, the `assetlinks.json` and the app identifiers all have to *match
what Circle issues*, rather than the other way round.

This is the most common cause of a passkey ceremony failing for reasons that look like code. It is
configuration, in five places, and none of the failures say so.

The domain itself does two jobs at once. It is the identity Circle validates your domain-bound
client key against — the app has no `window.location`, so `src/passkey/shim.ts` writes the hostname
Circle reads as `X-AppInfo` — **and** it is the WebAuthn relying party your phone's OS checks
against files you must host.

**1. In the Circle console** — [console.circle.com](https://console.circle.com) → Wallets → Modular
Wallets:

| | |
|---|---|
| Configurator → Passkey → Domain Name | your domain, e.g. `example.com` |
| The app identifiers, in that same Passkey configuration | your iOS **bundle identifier** and your Android **package name**. Circle validates *which app* is asking, not only the domain, so a key that works on web still refuses a native build that is not listed |
| Keys → Client Key (Web) | created against that domain |

**2. In `.env`** — `EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN`, the client key and URL, and the three
unprefixed copies the connector reads.

**3. In `app.json`** — three values, all of them currently ours:

```json
"ios":     { "bundleIdentifier": "com.example.yourapp",
             "associatedDomains": ["webcredentials:example.com"] },
"android": { "package": "com.example.yourapp" }
```

**4. Hosted at your domain over HTTPS**, both under `/.well-known/`. iOS reads the first, Android's
Credential Manager reads the second, and **a passkey cannot be created without them**:

`/.well-known/apple-app-site-association`, where `TEAMID` is your Apple Developer Team ID:

```json
{ "webcredentials": { "apps": ["TEAMID.com.example.yourapp"] } }
```

`/.well-known/assetlinks.json`, where the fingerprint is your app signing certificate's SHA-256:

```json
[{ "relation": ["delegate_permission/common.get_login_creds"],
   "target": { "namespace": "android_app",
               "package_name": "com.example.yourapp",
               "sha256_cert_fingerprints": ["AB:CD:…"] } }]
```

Ours are public if you want to see the shape that works:
[apple-app-site-association](https://kuiralabs.github.io/.well-known/apple-app-site-association),
[assetlinks.json](https://kuiralabs.github.io/.well-known/assetlinks.json). Apple documents the AASA
as needing `Content-Type: application/json`; GitHub Pages serves ours as `application/octet-stream`
and iOS accepts it, but a stricter host may not, and that failure looks identical to every other
domain problem.

**5. Rebuild.** `npm run ios` regenerates the native project — entitlements only change there, so an
edit to `app.json` without a rebuild changes nothing on the device.

**Expo Go cannot do passkeys**, on either platform. A dev build is required from the start, which is
what `npm run ios` and `npm run android` produce. Finding this out later costs more than starting
with one.

## 2. Prove the rules before touching a phone

```bash
npm install
npm run gate
```

That is the typecheck, the unit tests, the Solidity suite **against a fork of Arc with the real
Circle account and the real EntryPoint**, and the integration tests. If this passes, the mandate
engine works; everything after it is wiring.

| | |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over the app, the connector and the tests — the gate runs this first |
| `npm test` | parsing, encoding, the money type, mandate formatting, the meter the card reads, the connector |
| `npm run test:contracts` | the allowance rules, against a fork with the plugin installed on a real Circle account |
| `npm run test:integration` | the whole path: a signed user operation through the real EntryPoint, money moving, revocation taking effect, and an x402 payment checked against Circle's live facilitator |

Run `test:integration` on its own when you can. It forks live Arc, and sharing the RPC with another
suite has produced spurious failures with tests taking twenty times as long.

The first run is slow and mostly silent. `npm install` triggers `prepare`, which runs
`setup:contracts`: that fetches the five git submodules under `contracts/lib` and installs the
contract suite's own dependencies. The fork tests then pull state from Arc. Several minutes is
normal once; after that it is seconds.

**If the submodules fail, `npm install` still succeeds.** `prepare` sends that step's output to
`/dev/null`, so a failed fetch exits 0 and surfaces much later as `forge` not finding its libraries
inside `npm test`. Run `npm run setup:contracts` on its own to see the real error.

Arc's public RPC rate-limits, so a passing gate still prints some `429` and "rate limit exceeded"
warnings on the way. They are the endpoint pushing back, not failures; only the final result counts.

## 3. Make a wallet

```bash
npm run ios
```

Tap **Create a wallet** and confirm with Face ID. That is a passkey — there is no seed phrase, and
no key leaves the device.

Then fund it with test USDC from [Circle's faucet](https://faucet.circle.com), choosing **Arc
testnet**. A dollar is plenty; a step in the maze costs a tenth of a cent.

## 4. Give an agent the connector

```bash
cd /path/to/arc-agent-mandate                       # the absolute path matters, see below
claude mcp add arc-mandate -s user -- node "$PWD/mcp/server.ts"
```

`$PWD` is expanded by your shell, not by Claude, so running this from anywhere but the repo
registers a path that does not exist — and the failure arrives later as `CONNECTION_CLOSED`, which
names nothing. Check what was registered:

```bash
claude mcp list | grep arc-mandate                  # must end in .../arc-agent-mandate/mcp/server.ts
```

`-s user` matters too. Without it the server is registered in **local** scope, which is tied to the
directory you happened to run the command in and takes precedence over every other scope — so a
stale local entry silently shadows a correct one. If it is already wrong,
`claude mcp remove arc-mandate -s local` and add it again.

The server reads this repo's `.env` itself, so there are no secrets in your agent's config. Restart
the agent afterwards — an MCP server is only launched at startup.

Then ask it:

> **you:** what's your payment address?

It prints a QR code and an address. If it does not show you the QR, tell it to: the code is for your
phone's camera and is useless sitting in tool output. The code carries a one-time pairing code that
ties the allowance you grant to this agent, and it is also saved as `~/.arc-mandate/pairing-code.png`.

## 5. Grant an allowance, and watch it bind

In the app, scan that QR (or paste the link the agent prints), set an amount and a number of days,
and confirm with Face ID. An address typed on its own carries no pairing code, and the agent will
not use an allowance granted that way.

Now ask the agent to spend:

> **you:** check your allowance
> **you:** pay $0.05 to 0x000000000000000000000000000000000000dEaD

Then ask for more than you granted. The connector checks the limit first and answers without sending
anything, so that refusal is free. The point is what happens if it does not: the chain refuses the
payment itself, so a modified connector that skipped the check gets no further. On the rail this app
grants (one meter on Arc's ERC-20 view of USDC, which is what lets the phone show a single number)
that refusal happens when the payment runs: the operation is included and reverts, and its gas is
paid by Circle's sponsorship, not by you. No money moves.

Revoke in the app and try again: the next payment is refused at the account level, not by the agent
agreeing to stop.

## 6. Buy something real

The companion maze is live at **[arc-maze.vercel.app](https://arc-maze.vercel.app)**, and every step
through it costs a tenth of a cent. Its front page gives the sentence to hand your agent:

> **you:** Solve the maze at https://arc-maze.vercel.app/ and spend as little as you can.

The agent starts a run for free, gets a `402` on its first paid call, pays from the escrow your
allowance funds, and carries on. Each payment shows in the app as it happens. The maze's
[README](https://github.com/nel349/arc-maze#readme) has the full play-through.

To run the maze yourself instead:

```bash
git clone https://github.com/nel349/arc-maze && cd arc-maze
bun install
SELLER_ADDRESS=<any address you control> bun run start     # then use http://localhost:8790
```

## 7. Check it without trusting us

Every run is replayable by a stranger, because the maze is seeded from the round id. The run id is in
the agent's answers and on the maze's [list of every run](https://arc-maze.vercel.app/runs):

```bash
curl -s https://arc-maze.vercel.app/run/<run-id>/verify
```

That rebuilds the maze and re-walks the actions, taking nothing on trust — not the ending square, not
the step count, not the amount charged.

## If something goes wrong

| | |
|---|---|
| `Invalid credentials` from Circle | the one message for every domain mismatch. Work through *Pointing it at your own Circle account and domain* above: the key's domain, `EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN`, `app.json`'s `associatedDomains` and identifiers, the bundle id and package name registered with Circle, and whether your domain serves both `/.well-known/` files |
| A passkey never appears, or registration is refused on device | the OS is checking your domain, not Circle. `apple-app-site-association` must list `TEAMID.bundleid`, `assetlinks.json` must list the package with `common.get_login_creds`, and both must be served over HTTPS |
| The agent says it has no allowance | it was granted to a different address — ask it for its address again; a new key is generated if none exists |
| A payment says `unsupported_network` | something is pointed at Circle's **mainnet** Gateway. Arc is testnet-only today |
| `The allowance contract is not deployed on this network` | the app is on a network other than Arc testnet |
| Payments accepted but never arriving | the fee. Arc's base fee moves between 20 and 66 gwei and an operation at the bare estimate is accepted into the mempool and never included |
| `forge` cannot find its libraries | the submodule fetch failed silently during `npm install`. Run `npm run setup:contracts` |
| `npm start` fails on a clean clone | there is no dev build yet. Run `npm run ios` first |
