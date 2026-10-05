# @kuiralabs/mandate-core

What a wallet, an agent's connector and a server share to grant and spend a mandate, on any EVM
network the mandate runs on:

- **the networks**: one profile each for Arc testnet and Monad testnet, with the contracts a mandate
  uses there and which balance its limit meters
- **pairing**: the one-time code inside an agent's QR, and the tag a grant carries so the agent knows
  the grant is its owner's

Nothing here touches a file, a window or a process, so a phone app, a web page and a Node server import
it as it is.
