# Arc Agent Mandate

The W1 build: a React Native dev build registers a passkey through **our own** Expo module,
creates a Circle smart account on Arc Testnet, and sends one gasless USDC transfer.

Planning lives in `~/Development/arc` — read `arc-sdk/IMPLEMENTATION.md` § W1 before working here.

## Why our own passkey module

Circle ships no React Native SDK. Its **TypeScript** SDK runs in React Native (proven), but the
WebAuthn ceremony does not cross — that is the one OS-deep part. So: native exactly where the OS
is, TypeScript everywhere it is only encoding and HTTP.

## The piece Circle assumes a browser did

`@circle-fin/modular-wallets-core` calls `credential.response.getPublicKey()` and never touches
`attestationObject` — it assumes a browser already CBOR-parsed it. Native gives only
`rawAttestationObject`. `src/passkey/cose.ts` is that missing parser.

## Status

W1, in progress. Blocked on a Circle Console client key and a passkey domain.
