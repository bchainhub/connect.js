# Examples

## JavaScript / TypeScript discovery

```typescript
import { installWalletProvider, ethereumRpcMethods } from 'connect-protocol';

const discovery = installWalletProvider({
  // Declare optional methods only for wallets whose capabilities you know.
  adapterOptions: (blockchain, id) => ({
    rpcMethods: blockchain === 'ethereum' ? ethereumRpcMethods : [],
  }),
});
const api = discovery.api;
const wallets = api.getProviders('ethereum');
// Render all wallets and let the user select an ID; never pick index 0 silently.
async function onWalletChosen(providerId: string) {
  await api.connect({ blockchain: 'ethereum', providerId });
  const accounts = await api.getAccounts();
  const balance = await api.getBalance({ network: '0x1' });
  console.log(accounts, balance);
}
// A button can call: await api.signMessage('hello');
// Per-call override: await api.getBalance({blockchain: 'solana'});
// Native RPC: await api.request({blockchain:'ethereum',method:'eth_chainId'});
// At teardown: discovery.dispose();
```

The same code works in JavaScript after removing type annotations. Imports are also
available from `connect-protocol/wallet`. In a browser installed by this function,
`window.connect` refers to `api` when no prior global existed. Check `installed` when
integrating with another library that may already own `window.connect`.

## Native SDK adapters

```typescript
import { createNativeWalletAdapter, UniversalWalletProvider } from 'connect-protocol';
const core = createNativeWalletAdapter('core', coreSdk, {
  id: 'my-core-sdk', networks: ['1', '3'],
  rpcMethods: ['xcb_getBalance'], // exact RPC dialect of this SDK
  handlers: {
    connect: () => coreSdk.connect(),
    getChainId: () => coreSdk.getChainId(),
    getBalance: (_, options) => coreSdk.getBalance(options.account),
  },
  validateTransaction: (transaction) => coreSdk.validateTransaction(transaction),
});
const api = new UniversalWalletProvider([core]);
await api.connect({blockchain:'core'});
await api.request({blockchain:'core',method:'xcb_getBalance',params:[coreAddress]});
```

`coreSdk`, `coreAddress` and UI actions are application-owned. No provider or SDK is
bundled for a specific wallet. TON Connect and NEAR Wallet Selector follow the same
registration pattern after their host SDK has been configured.

## Flutter / Dart

```dart
import 'package:flutter_connect/flutter_connect.dart';

final adapter = NativeWalletAdapter(
  id: 'selected-bitcoin-sdk',
  blockchain: Blockchain.bitcoin,
  nativeProvider: NativeWalletApi(methods: {
    'requestAccounts': (_) => bitcoinSdk.requestAccounts(),
    'getAccounts': (_) => bitcoinSdk.getAccounts(),
    'signPsbt': (args) => bitcoinSdk.signPsbt(args.single),
  }),
);
final api = UniversalWalletProvider([adapter]);
await api.connect(options: const WalletCallOptions(blockchain: Blockchain.bitcoin));
final accounts = await api.getAccounts();
final signed = await api.signPSBT(psbt);
// Browser: final discovered = installWalletProvider();
// Native SDK transaction objects pass unchanged through handler callbacks.
api.dispose();
```

For an explicit override use `options: WalletCallOptions(blockchain: Blockchain.core)`.
Native apps register adapters; only browser builds discover/inject window globals.
See [chain support](blockchains.md) before treating a catalog method as implemented.

## Extended Core / Ethereum actions

```typescript
import { installWalletProvider, coreRpcMethods, ethereumRpcMethods } from 'connect-protocol';
const discovery = installWalletProvider({
  adapterOptions: (blockchain) => ({
    rpcMethods: blockchain === 'core' ? coreRpcMethods
      : blockchain === 'ethereum' ? ethereumRpcMethods : [],
  }),
});
const api = discovery.api;
// Use a provider ID chosen by the user from getProviders('core').
await api.connect({blockchain: 'core', providerId: selectedCoreProviderId, network: 1});
const fee = await api.estimateFee({to: coreAddress, value: 1n});
const unsigned = await api.prepareTransaction({to: coreAddress, value: 1n});
const signed = await api.signTransaction(unsigned); // no broadcast
const balance = await api.getTokenBalance({token: tokenAddress});
const receipt = await api.waitForTransaction({hash: transactionHash, confirmations: 2});
```

The exported allowlists are opt-in declarations; configure only methods supported by
the selected wallet. Flutter uses coreRpcMethods/ethereumRpcMethods on
NativeWalletAdapter, or NativeWalletConfiguration during discovery. Its codecs and
named actions follow the same request shapes, using Dart BigInt for large integers.
