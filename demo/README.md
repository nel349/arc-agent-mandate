# Watching the mandate work

A terminal demo of the whole idea, on a local fork of Arc. Nothing here touches a real chain, and
it needs no passkey, no deployer key and no funded account.

```bash
./demo/setup.sh                                  # fork Arc, deploy, install, grant a mandate
PLUGIN=$(cat /tmp/demo-plugin.txt) node demo/run.mjs
```

## What you are looking at

The wallet is the **real** Circle smart account from the W1 spike, with its real WebAuthn multisig
and the real EntryPoint v0.7, all forked from Arc testnet. Only our plugin is new.

The seller (`demo/seller.mjs`) is a service that charges $2 a query and checks the chain before it
answers, so an unpaid request gets nothing. The agent (`demo/agent.mjs`) holds one key and no
authority: it asks, is told the price, pays, and asks again.

The wallet holds **500 USDC** and the mandate is **10**. That gap is the point — the demo has to
show the *mandate* stopping the agent, not the balance running out. On screen those look
identical and mean opposite things.

## Two things worth knowing before changing this

**Do not use anvil's default accounts on an Arc fork.** Their private keys are public, so on Arc
testnet every one of them already carries an EIP-7702 delegation (`0xef0100 || address`) pointing
at a sweeper. A fork inherits it, so value sent to one is forwarded away as it lands — and the
user operation still reports `success = true`, because the transfer did not fail. The demo derives
its keys from a namespaced seed instead.

**A refusal arrives as a reverted receipt, not a thrown error.** The agent passes an explicit gas
limit, so viem does not simulate. Unchecked, the agent then hands the seller a transaction hash
for a payment that never happened, and the seller's "payment not observed" becomes the story
instead of the mandate's refusal.
