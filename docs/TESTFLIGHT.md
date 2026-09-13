# TestFlight: what to paste, and why it says what it does

Everything App Store Connect asks for before an external group can be given a public link. Copy the
blocks as they are.

A reviewer opens the app. That is the thing to design these answers around: this app's whole point
happens between a phone and an agent on a desktop, and a reviewer has only the phone. Left
unexplained, the app looks like it does nothing, and a query from review costs more time than the
review itself.

## Beta App Description

> Arc Agent Mandate is a developer tool from the ETHOnline hackathon. It lets somebody give an AI
> agent a spending allowance on a test blockchain, and take it away again.
>
> The phone is the control surface. You create a wallet that opens with Face ID, add test dollars to
> it from a free faucet, and grant an allowance by scanning a code the agent shows. The allowance
> names a limit and an end date, and the limit is enforced by the network rather than by the agent's
> good behaviour. You can watch what the agent spends and revoke it at any time.
>
> The agent itself is a separate program that runs on a desktop computer, so what it spends cannot be
> shown from the phone alone. Everything the phone owns can be: creating a wallet, funding it,
> granting an allowance, reading what has been spent, and revoking.
>
> No money is real. The app runs on Arc testnet and the dollars come from a free faucet.

## What to test

> No account and no sign-in. The wallet is a passkey created on the device.
>
> 1. Open the app and tap "Create a wallet". Confirm with Face ID or a passcode. This makes the
>    passkey and the wallet together; nothing is sent anywhere and no email is asked for.
> 2. Tap the balance to reach the faucet, which gives the new wallet test dollars. It is free and
>    needs no account.
> 3. Tap "New allowance". The camera opens to scan an agent's code. There is no agent to hand during
>    review, so this is the point where the flow needs a desktop; the screen can be backed out of.
> 4. The Rewards tab shows what an agent has earned for this wallet. It is empty for a new wallet,
>    which is correct.
> 5. Settings, reachable from the gear, holds the network and the wallet's address.
>
> To see the whole flow, including an agent spending under an allowance, the desktop half is at
> https://github.com/nel349/arc-agent-mandate and the service the agent buys from is at
> https://arc-maze.vercel.app.

## Review notes

> Sign-in: none. The wallet is created on the device with a passkey and there is no account, no
> password and no email.
>
> Camera: used only to scan an agent's pairing code, which is a QR holding a public address. Nothing
> is recorded and no images are stored.
>
> Network: Arc testnet, a test blockchain. The balances shown are test dollars from a public faucet
> and have no value.
>
> The app is open source: https://github.com/nel349/arc-agent-mandate

## The fields, and what goes in each

| Field | What |
|---|---|
| Beta App Description | the block above |
| Feedback Email | yours |
| Marketing URL | https://github.com/nel349/arc-agent-mandate |
| Privacy Policy URL | required for external testing; the repository's README serves if there is nothing else |
| What to Test | the block above |
| App Review notes | the block above |
| Export compliance | not asked. `ios.config.usesNonExemptEncryption` is `false` in `app.json`, which is the exempt case: the app uses the platform's own TLS and the passkey signing the OS provides, and adds no encryption of its own |

## Before the first build

Three things are needed that no other part of this repository asks for, and each fails late rather
than early:

- **`eas-cli`, installed separately.** It is not a dependency of this project and is not in
  `node_modules`. `eas.json` requires `>= 16.3.3`: `npm i -g eas-cli`, then `eas login`.
- **The `EXPO_PUBLIC_CIRCLE_*` values, set in EAS.** `eas.json` has no `env` block, so an EAS build
  does **not** pick up your local `.env`. Expo inlines those three at build time, so a build made
  without them produces an app that cannot reach Circle — and the symptom on the device is
  `Invalid credentials`, which names none of this. Set them on the build profile, or with
  `eas env:create`, before building.
- **Your own EAS project.** `app.json` pins `extra.eas.projectId` to this account's project. A
  fresh clone has to replace it, via `eas init`, or the build is pushed at a project you cannot
  submit from.

## Order of operations

1. `eas build --platform ios --profile production`
2. `eas submit --platform ios --latest`
3. App Store Connect → TestFlight → **Test Information**: the fields above.
4. **External Testing** → new group → add the build → submit for Beta App Review.
5. When it clears, open the group and turn on the **Public Link**. That link needs no emails and
   takes up to 10,000 testers.

The first build of a version is the one that waits for review, typically about a day. A later build
that changes nothing a reviewer reads usually clears in well under an hour, so replacing the icon or
fixing a bug after this is cheap. Builds expire 90 days after upload.
