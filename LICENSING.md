# Licensing

Three licences apply in this repository, and which one governs a file depends on where it sits.
The SPDX header on each Solidity file is authoritative; this page exists so nobody has to open
forty files to work out the shape.

| what | licence | where the text is |
|---|---|---|
| The app, the SDK, the MCP connector, the scripts | MIT | [`LICENSE`](LICENSE) |
| The session-key plugin | **GPL-3.0-or-later** | [`contracts/LICENSE`](contracts/LICENSE) |
| Vendored helpers inside the plugin | MIT | their own SPDX headers |

## Why the plugin is GPL

`contracts/src/session` is a port of [Alchemy's Modular Account][alchemy] session-key plugin from
ERC-4337 v0.6 to v0.7. That work is GPL-3.0-or-later, so this is a derivative and carries the same
licence — not by preference but by obligation, and the obligation is one worth meeting properly:
the port is the part of this project most likely to be useful to somebody else, and a copyleft
derivative published without its licence is unusable by exactly the people it was written for.

Every deviation from upstream is recorded in `contracts/src/session/PORTING.md`, which is the file
to read before trusting the port with money.

[alchemy]: https://github.com/alchemyplatform/modular-account

## The MIT files inside the GPL directory

`contracts/src/session/vendor` holds four files taken from [`modular-account-libs`][libs], which is
MIT: `PluginStorageLib.sol`, `Constants.sol`, `LinkedListSetLib.sol` and
`AssociatedLinkedListSetLib.sol`. They keep their own MIT headers.

This is deliberate rather than untidy. MIT code may sit inside a GPL work — the combined result is
GPL, and each file keeps the licence it arrived with. Anyone extracting one of those four files
takes it under MIT; anyone taking the plugin takes the whole thing under GPL.

[libs]: https://github.com/erc6900/modular-account-libs

## What this means if you want to use any of it

- **The connector, the SDK, the app** — MIT. Take it, change it, ship it, no obligation beyond
  keeping the notice.
- **The plugin** — GPL-3.0-or-later. If you distribute something built on it, that thing is GPL
  too. Reading `PORTING.md` first will save you the week it took to find out why v0.6 plugins
  cannot serve a v0.7 account.
- **The maze** ([`arc-maze`](https://github.com/nel349/arc-maze)) is a separate repository, MIT
  throughout, including the `CohortZero` badge contract.
