# Universal API and routing

The first successful connection becomes active. Later operations resolve an explicit
`blockchain` override first, otherwise the active connection, then the selected
provider for that blockchain. A sole available provider can be resolved without a
selection; ambiguity throws `ProviderNotFoundError`. Discovery itself does not connect.

An override applies only to that call. Connecting another blockchain while one is
active does not replace the active connection unless `activate: true` is supplied.
`switchBlockchain` explicitly activates an already connected provider. `switchNetwork`
and `addNetwork` are separate native operations; they are never called implicitly.
`network` in call options checks the current network and throws on mismatch.
EVM/Core hex and decimal network IDs compare numerically; Core networkId and UTXO chain-enum objects are recognized.

JS common options: `{blockchain?, providerId?, account?, network?, requestId?, address?, addresses?, tokens?, blockTag?, nativeOptions?}`. address is a public read target; account is an authorized signing account. getBalances uses addresses, and getTokenBalances uses an explicit tokens list.
Flutter passes a `WalletCallOptions` through the named `options` argument.
Queries without a payload take options directly in JS (`getBalance(options)`).
Payload methods take `(input, options)`. Flutter uses `(input, options: options)`.

Connection/inspection methods: `connect`, `disconnect`, `isConnected`, `getProviders`,
`getProvider`, `getConnectedProvider`, `getAvailableBlockchains`, `getCapabilities`,
`getConnectedBlockchain`, `selectProvider`, `switchBlockchain`. JS/Dart `getProvider`
returns the adapter; Flutter's JS facade returns a serializable descriptor.

The capability-based method catalog includes:

| Group | Methods |
| --- | --- |
| Accounts | getAccounts, getAccount, getPublicKey, getAddress, getAddresses, getBalance, getBalances, getTokenBalance, getTokenBalances, getAssets, getNFTs, getNonce, getUTXOs |
| Networks | switchNetwork, addNetwork, getChainId, getNetwork, getBlockNumber, getBlock, getTransaction, getTransactionReceipt, getTransactionStatus, getGasPrice, estimateGas, estimateFee |
| Signing | signMessage, verifyMessage, signTypedData, signTransaction, signTransactions, signAndSendTransaction, signPSBT, signPSBTs, signData |
| Transactions | sendTransaction, sendRawTransaction, transfer, transferToken, transferNFT, prepareTransaction, simulateTransaction, estimateTransactionFee, waitForTransaction |
| Contracts | getCode, getStorage, callContract, readContract, writeContract, sendContractTransaction, deployContract, estimateContractGas, encodeContractCall, decodeContractResult, getContractEvents |
| Tokens | getTokenMetadata, getTokenAllowance, approveToken, watchAsset, addToken |

Every catalog method exists on the API; only declared capabilities execute. Some
catalog methods still need a compatible native SDK or host handlers, particularly asset/NFT indexing and chain-specific builders.
See the actual support matrix in [blockchains](blockchains.md). `getAccount` and
`getAddress` require exactly one authorized account unless the adapter supplies an
explicit native address implementation; they do not silently pick an account.

`request({blockchain?, method, params?})` is the native escape hatch on the new API.
Only adapter-declared RPC methods are forwarded. For EVM, the default allowlist is
`eth_requestAccounts`, `eth_accounts`, `eth_chainId`. Core defaults to xcb_requestAccounts/xcb_accounts/xcb_networkId. Configure optional RPCs explicitly
using rpcMethods; ethereumRpcMethods and coreRpcMethods export broader sets for a host that knows
its wallet supports them. Incompatible chain prefixes and secret-bearing methods are
rejected. Unknown native calls require a connected wallet; known read queries can run
passively. Native account authorization calls should use `connect` to update session state.

Contract state reads accept `getCode(address, options)` or
`getCode({ address }, options)`, and `getStorage({ address, position }, options)`.
Both honor `blockTag` and run without connecting. Storage positions accept lossless
integer quantities; values outside the unsigned 256-bit range are rejected.
