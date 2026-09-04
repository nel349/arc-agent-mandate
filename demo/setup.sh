#!/usr/bin/env bash
# Stands the whole demo up on a local fork of Arc. Nothing here touches a real chain.
set -euo pipefail
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
cd "$(dirname "$0")/.."
R=http://127.0.0.1:8545
EP=0x0000000071727De22E5E9d8BAf0edAc6f37da032
MSCA=0xa8546Ff7D7Fcd3BBd08C0ef31E74C73DF6BcC447

pkill -f "anvil --fork-url" 2>/dev/null || true
pkill -f "demo/seller.mjs" 2>/dev/null || true
sleep 1
nohup anvil --fork-url https://rpc.testnet.arc.network --fork-block-number 60219238 \
  --port 8545 --silent > /tmp/anvil.log 2>&1 &
sleep 6

eval "$(node -e '
import("./demo/lib.mjs").then(async (m) => {
  const { privateKeyToAccount } = await import("viem/accounts");
  const bundler = privateKeyToAccount(m.BUNDLER_PK).address;
  await m.fundOnFork([bundler]);
  console.log(`AGENT=${privateKeyToAccount(m.AGENT_PK).address}`);
  console.log(`SELLER=${m.SELLER}`);
});')"

# The wallet is funded well above the mandate on purpose: the demo has to show the *mandate*
# stopping the agent, not the balance running out. Those look identical on screen and mean
# opposite things.
cast rpc anvil_setBalance $MSCA 0x1b1ae4d6e2ef500000 --rpc-url $R > /dev/null   # 500 USDC
cast rpc anvil_impersonateAccount $EP --rpc-url $R > /dev/null
cast rpc anvil_setBalance $EP 0xde0b6b3a7640000 --rpc-url $R > /dev/null

cd contracts
PLUGIN=$(AGENT_ADDRESS=$AGENT SELLER_ADDRESS=$SELLER MANDATE_WEI=10000000000000000000 \
  forge script script/SetupDemo.s.sol --rpc-url $R --broadcast --unlocked --sender $EP 2>&1 \
  | grep "plugin  :" | awk '{print $3}')
cd ..

nohup node demo/seller.mjs > /tmp/seller.log 2>&1 &
sleep 2
echo "  fork up, plugin deployed, mandate granted."
echo "$PLUGIN" > /tmp/demo-plugin.txt
