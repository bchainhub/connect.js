# Implemented blockchain capabilities

Only native functions and explicitly declared RPCs are advertised. Discovery does not
connect wallets, grant permissions, choose among wallets or fetch balances.

| Blockchain | Global | Implemented actions |
| --- | --- | --- |
| Core | window.core | CIP-6963; account access and network ID; balance/nonce, bytecode/storage, blocks, transactions, receipts/logs; signing, sending and raw broadcast; personal messages and CIP-712; energy estimates/prices, fee estimates and unsigned preparation; native transfers; Core ABI calls/writes/deployment, token reads/approvals/transfers and ERC-compatible NFTs. Optional RPCs must be declared. Native SDK methods remain usable. |
| Ethereum / EVM | window.ethereum | EIP-6963/EIP-1193; accounts/network, balances, nonce, bytecode/storage, blocks/transactions/receipts/logs, message/typed-data/transaction signing, submission, network addition/switching, asset watching; gas/fee estimates, preparation, simulation, native/token/NFT transfers, ABI reads/writes/deployment. Optional RPCs must be declared. |
| Solana | window.solana | Native connect/disconnect/publicKey; UTF-8/byte message signing, legacy/versioned native transaction signing, batch signing and sign-and-send when exposed. JS additionally adapts registered Wallet Standard features, serialized transaction bytes, per-request network selection, account features and bulk signing. Read-only balances/fees/block queries require compatible SDK functions/host handlers. |
| Bitcoin | window.bitcoin | requestAccounts/connect, account/public-key access, balances/UTXOs where exposed, getChain/switchChain or legacy network functions, message-signing variants, PSBT/batch PSBT signing with options, sendBitcoin and raw pushTx. Amounts are integer native base units. |
| Litecoin | window.litecoin | Separate native Litecoin SDK functions; account/network/balance/UTXO access, message/PSBT signing where exposed, sendLitecoin and raw submission. No Bitcoin signatures or address rules are substituted. |
| Cardano | window.cardano wallet entries | CIP-30 enable, network/used/change/unused/reward addresses, CBOR balances/UTXOs, collateral/extensions when exposed, signData, signTx and native witness batch signing, submitTx. Signed transaction assembly is never guessed. |
| Aptos | window.aptos | Legacy account/network/public-key access, message and native transaction signing, signAndSubmitTransaction for sending, optional changeNetwork. Current wallet-adapter SDKs can be registered through NativeWalletApi/handlers. |
| TON | window.ton | Compatible SDK account/chain access, transaction and signData requests. TON Connect onStatusChange keeps connection links pending until authorization; native SDK configuration and wallet selection stay with the host. |
| NEAR | window.near | Compatible Wallet Selector signIn/signOut/getAccounts/signMessage, native signing and signAndSendTransaction mapped to submission. Batch broadcasting is never treated as sign-only. |
| Monero | window.monero | Native accounts/balances/networks, getPrimaryAddress, public spend key, signMessage with optional signature/account/subaddress arguments, native signing/submission and relayTx metadata where supplied. No private spend/view keys are exposed. |
| Zcash | window.zcash | Native SDK account/network/balance/read actions and signing/submission when present. Transparent and shielded transaction objects remain native; batch signing never implies Bitcoin PSBT compatibility. |

The compatibility globals identify blockchains, not wallet brands. Every global is
installed only for a supplied provider and only when absent; discovery preserves
existing globals. Ethereum and Core have standardized discovery event mappings. Other
chains' compatibility globals are not claimed to be universal ecosystem standards.

## RPC configuration

Ethereum defaults to eth_requestAccounts, eth_accounts and eth_chainId. Core defaults
to xcb_requestAccounts, xcb_accounts and xcb_networkId. Exported ethereumRpcMethods and
coreRpcMethods are broader opt-in allowlists, not evidence that a particular wallet
supports every entry. Missing/rejected native methods return typed errors without
switching to another wallet or RPC dialect. When only a passive account-list RPC is
declared, connect can attach an already authorized, nonempty account list; it does not
manufacture permissions.

Core mappings follow CoreBC's xcb_* methods, energy/energyPrice and networkId fields,
22-byte ICAN values and SHA3-256 selectors. CIP-712 payloads use domain.networkId;
Ethereum chainId, legacy Keccak selectors and 20-byte addresses are not substituted.
Core network switching/adding requires actual native SDK methods or host handlers;
no hypothetical wallet_switchCoreChain method is invented.

## Remaining boundaries

No generic asset/NFT indexer, endpoint selection, token-list discovery, wallet keys,
UTXO transaction builder, Cardano witness assembly, Aptos Move transaction builder,
TON cell builder or NEAR action builder is fabricated. Such operations work when a
compatible native SDK function/handler is supplied; otherwise they throw
UnsupportedMethodError. Network checks fail explicitly when no reliable network
source is available. Wallet Standard validates per-request chains instead of requiring
an unrelated active-network RPC.

JavaScript verifies Ethereum personal messages and Core's 171-byte personal-sign
format locally. Flutter verifies Ethereum EOA messages locally; Core local message
verification requires a host handler. Neither built-in verifier claims ERC-1271
contract-account verification or application-specific typed-data verification.

References: [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193),
[EIP-6963](https://eips.ethereum.org/EIPS/eip-6963),
[CIP-30](https://cips.cardano.org/cip/CIP-0030),
[UniSat native API](https://docs.unisat.io/developer-support/open-api-documentation/unisat-wallet.md),
[Wallet Standard](https://github.com/wallet-standard/wallet-standard).

## CoreBC comparison

The Core mappings were checked against the workspace `corebc.js` implementation:
`provider-jsonrpc.ts`, `abstract-provider.ts`, the ABI address coder, message hashing
and signing. `getCode(address, options)` and
`getStorage({ address, position }, options)` expose contract bytecode and storage.
`position` is an unsigned 256-bit integer; `options.blockTag` defaults to `latest`.
These reads do not request wallet authorization. Core RPC allowlists include
`xcb_getCode` and `xcb_getStorageAt`; native CoreBC provider methods receive their
original positional arguments. Ethereum has the equivalent `eth_*` mappings.

CoreBC is a reference, not a new runtime dependency. Key management, mnemonic/keystore
operations, node account unlocking, mining and node administration remain outside the
wallet provider API. CoreBC provider/signer composition and SDK-specific multi-argument
signing can be integrated through explicit host handlers.

Core private networks use IDs **10 and above** (`ce` addresses). The default private
ID is `10`; `0` is not a private-network ID. Explicit address/network checks reject
unassigned IDs. Mainnet remains `1` (`cb`), and test IDs `3`/`4` use `ab`.
