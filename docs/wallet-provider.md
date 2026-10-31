# Universal wallet provider

`UniversalWalletProvider` is the native-wallet API. It manages provider registration,
explicit selection, active connection, capabilities and dispatch. Existing
`UniversalProvider`, `ConnectClient`, signing adapters and operation transports keep
their existing APIs. `UniversalProvider` remains the Connect operation-envelope
client; its `request` is not the native RPC escape hatch described here.

The main JavaScript entry and `/wallet` export the new API. Flutter exports it from
`package:flutter_connect/flutter_connect.dart`. The JavaScript additions reuse existing dependencies; Flutter promotes the already-present PointyCastle package to a direct dependency for ABI hashes and Ethereum verification.

A `WalletAdapter` declares `blockchain`, `id`, `nativeProvider`, optional `info`,
connection state, methods/native RPCs/networks, invocation and event subscriptions.
JS uses `createNativeWalletAdapter(blockchain, nativeObject, options)`; Dart uses
`NativeWalletAdapter` with `NativeWalletApi`, a map of host-owned native callbacks.
Native Dart wallets can adapt their existing SDK without reflection or browser APIs.

`handlers` explicitly supplies ecosystem SDK operations whose arguments do not match
the built-in mappings. `validateTransaction` can enforce chain/network-specific
transaction rules. Core/EVM RPC and ABI checks are built in; arbitrary Core, UTXO, Solana,
Aptos, TON and NEAR transactions still require the native wallet/SDK's validation.
No private keys, signing algorithms, network formats or wallet permissions are synthesized.

Use `getCapabilities` before exposing an action. A function name in the universal
catalog is not evidence that a wallet implements it. Missing methods throw
`UnsupportedMethodError`. No alternate wallet is selected on an error.

See [examples](examples.md), [discovery](wallet-discovery.md),
[chain support](blockchains.md) and [universal methods](universal-api.md).

Per-request network adapters must validate the requested chain and bind it into every
native invocation. JavaScript declares networkMode: 'per-request'; custom Dart SDK
adapters implement PerRequestNetworkWalletAdapter. This mode is used by JS Wallet
Standard, where an active-network RPC is neither required nor inferred from a list
of supported chains. Default adapters continue checking the native active network.
