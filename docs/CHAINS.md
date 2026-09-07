# Chains and wallet adapters

Connect authenticates a wallet key/address. It does not transfer coins, enumerate tokens, check balances, or grant token permissions. Tokens on supported chains use the same wallet identity; no per-token signing profile is necessary.

Select named chains in ordinary application code. Profiles remain explicit on the wire so a verifier cannot confuse signing formats. `allChains` / `ConnectChains.all` includes the fourteen requested mainnets and two alternate signing methods (Bitcoin legacy and XRP Ed25519). Raw Ed25519 remains available explicitly for development or applications using raw-key identities.

| Preset (TypeScript / Dart) | Identity and network | Wallet signing operation | Proof signature / publicKey | Supported addresses |
| --- | --- | --- | --- | --- |
| `core` | `core:1` | Pure Ed448 on canonical bytes | lowercase hex / 57-byte key hex | Core Blockchain XCB ICAN `cb…`; this is not Core DAO |
| `ethereum` | `eip155:1` | EIP-191 `personal_sign` of SIWE | `0x` hex / absent | EIP-55 EOA |
| `polygon` | `eip155:137` | Same SIWE method | `0x` hex / absent | Polygon PoS EOA |
| `base` | `eip155:8453` | Same SIWE method | `0x` hex / absent | Base EOA |
| `bnb` | `eip155:56` | Same SIWE method | `0x` hex / absent | BNB Smart Chain EOA |
| `bitcoin` | `bip122:000000000019d6689c085ae165831e93` | BIP-322 simple | canonical padded base64 / absent | Native SegWit v0 P2WPKH `bc1q…`, SIGHASH_ALL |
| `bitcoinLegacy` | Same Bitcoin network | Bitcoin `signmessage` | canonical padded base64 / absent | Legacy P2PKH `1…`, compressed or uncompressed key |
| `solana` | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | Ed25519 `signMessage` on canonical bytes | 64-byte lowercase hex / absent | Base58 Ed25519 public key, no PDA |
| `tron` | `tron:728126428` | `signMessageV2` | `0x` lowercase hex / absent | Base58Check `T…` key address |
| `monero` | `monero:418015bb9ae982a1975da7d79277c270` | `sign` with `signature_type: spend` | Original `SigV2…` string / absent | Mainnet standard and subaddresses; no integrated address or view-key proof |
| `stellar` | `stellar:pubnet` | SEP-53 message signing | 64-byte lowercase hex / absent | `G…` Ed25519 StrKey, no muxed/contract address |
| `litecoin` | `bip122:12a765e31ffd4059bada1e25190f6e98` | Litecoin `signmessage` | canonical padded base64 / absent | Legacy P2PKH `L…` |
| `ripple` | `xrpl:0` | `ripple-keypairs.sign(messageHex, privateKey)` | lowercase DER hex / compressed key hex | XRP classic `r…`, secp256k1 |
| `rippleEd25519` | Same XRP network | Same API with Ed25519 key | 64-byte lowercase hex / `ed`-prefixed 33-byte key hex | XRP classic `r…`, Ed25519 |
| `zcash` | `bip122:00040fe8ec8471911baa1db1266ea15d` | Zcash `signmessage` | canonical padded base64 / absent | Transparent P2PKH `t1…`; no shielded/unified addresses |
| `cardano` | `cip34:1-764824073` | CIP-30 `signData(addressHex, payloadHex)` | COSE_Sign1 lowercase hex / COSE_Key lowercase hex | Mainnet Shelley base with key payment credential, enterprise key address, or reward key address |

Signing method availability depends on the host wallet. These are protocol adapters and verifiers, not integrations with every named wallet application. XRP wallets exposing only a transaction or proprietary sign-in API need a compatible message-signing bridge. Transactions are never substituted for authentication messages.

## TypeScript wallet

```ts
import { chains, walletAccount } from 'connect.js';

const account = walletAccount(chains.solana, address, async bytes => {
  const result = await wallet.signMessage(bytes);
  return { signature: Array.from(result.signature, b => b.toString(16).padStart(2, '0')).join('') };
});
// Return this account from WalletAccountProvider.getAccounts().
```

A provider can expose several entries for the same address if it supports different methods, such as `chains.bitcoin` versus `chains.bitcoinLegacy`. `accountFor(chain, address)` supplies an immutable selection without a signer. `defineChain` defines additional metadata, and `evmChain('Arbitrum', 42161)` adds an EVM network using the existing SIWE verifier. The relying application must explicitly enable the same network in its challenge requirements.

For Ethereum-compatible providers, pass the UTF-8 canonical bytes as `0x` hex to `personal_sign`, with the selected EIP-55 address. For Cardano, pass those bytes as payload hex to CIP-30 and return `{ signature: result.signature, publicKey: result.key }`; `addressHex` must correspond to the selected Bech32 address. For Stellar, a SEP-53 wallet API applies SHA-256 to `Stellar Signed Message:\n` plus canonical bytes; a raw Ed25519 signer must implement that wrapper. TRON, UTXO and Monero wallet APIs apply their own prescribed wrappers. Never prefix or hash twice. Core and Solana sign the raw canonical bytes.

## Flutter wallet

```dart
final account = ChainWalletAccount(
  chain: ConnectChains.solana,
  address: address,
  sign: (bytes) async {
    final signature = await wallet.signMessage(bytes);
    return WalletSignature(signature.map((b) => b.toRadixString(16).padLeft(2, '0')).join());
  },
);
```

`ConnectChain.evm('Arbitrum', 42161)` mirrors TypeScript. The `ConnectChain` constructor supports other protocol definitions. Keys stay in the host wallet. Wallet entry points do not load the signature verifiers or Monero WASM.

## Better Auth

```ts
import { betterConnect, allChains, chains } from 'better-connect';

betterConnect({ origin: 'https://example.com', chains: allChains });
// Or explicitly choose a subset:
betterConnect({ origin: 'https://example.com', chains: [chains.core, chains.ethereum, chains.solana] });
```

The lower-level `requirements` option remains supported. Supply either `chains` or `requirements`, never both; empty policy is rejected. Authentication is opt-in, not automatically expanded when more chains become available in a future release.

To add a new signing standard, implement `SigningProfile`, or use `defineSigningProfile({ id, namespace, alg, validateAccount, verify })`. The wrapper rejects malformed library results and only returns the claimed address after successful validation. Extend with `new ProfileRegistry().with(customProfile)` and a matching `defineChain` definition. A new EVM network needs only `evmChain`. A Bitcoin-like P2PKH network can use `utxoMessageProfile` with its exact genesis reference, signed-message magic, and address-version bytes. Add positive, wrong-key, network, mutation and replay vectors before enabling any new scheme. Defining metadata alone never installs a verifier.

## Verification boundaries

All profiles prove possession of the key associated with the selected address. They do not inspect live account permissions, master-key disabling, weighted/multisignature policies, delegated signers, or contract account validation. In particular, Stellar/XRP/TRON ledger authority may differ from key possession. ERC-1271 and script wallets are not implemented. Only the address types in the table are accepted; no signature-format guessing or automatic fallback occurs.

Cardano enforces protected EdDSA (`-8` inside legacy CIP-8 COSE, Ed25519 curve 6 and OKP key type 1), the exact protected address, the payload and a matching Blake2b-224 key credential. The Connect algorithm remains the fully specified Ed25519 identifier `-19`. Attached unhashed and Blake2b-224-hashed payloads are supported. Protected headers must be exactly algorithm and address; unprotected headers exactly `hashed`; COSE_Key exactly kty, alg, crv and x. Unknown/critical extensions, duplicate map keys, detached payloads, pointers, scripts and Byron addresses are rejected.

Monero verification lazily loads monero-project WASM through monero-ts, operates offline, validates the address checksum/network, and accepts only modern spend-key SigV2 proofs. Each verification closes its temporary in-memory wallet; it does not persist a wallet or contact a daemon. This is heavier than the other verifiers and requires WebAssembly. connect.js ships browser WASM chunks; better-connect owns the Node WASM loader and bundles its patched Monero dependency. The Bitcoin legacy signing library is used only in better-connect tests as an independent signing implementation; production recovery uses noble. Remaining low-severity elliptic audit notices are limited to that development dependency.

## Standards and references

- [SIWE / ERC-4361](https://eips.ethereum.org/EIPS/eip-4361), [BIP-322](https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki).
- [Solana keys and PDAs](https://solana.com/docs/core/pda), [TRON signMessageV2](https://tronweb.network/docu/docs/API%20List/trx/signMessageV2/).
- [Stellar SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md), [XRP keypairs](https://github.com/XRPLF/xrpl.js/tree/main/packages/ripple-keypairs).
- [Monero wallet RPC](https://www.getmonero.org/resources/developer-guides/wallet-rpc.html), [monero-ts](https://github.com/woodser/monero-ts).
- [Cardano CIP-8](https://cips.cardano.org/cip/CIP-8), [CIP-30](https://cips.cardano.org/cip/CIP-30), [CIP-34](https://cips.cardano.org/cip/CIP-34).
- [Litecoin signed messages](https://github.com/litecoin-project/litecoin/blob/master/src/util/message.cpp), [Zcash message magic](https://github.com/zcash/zcash/blob/master/src/main.cpp), [Zcash address versions and genesis](https://github.com/zcash/zcash/blob/master/src/chainparams.cpp).
- [CAIP namespaces](https://namespaces.chainagnostic.org/), [Base chain ID](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId), [Polygon chain ID](https://docs.polygon.technology/wallets/wallet-operations), [BNB configuration](https://docs.bnbchain.org/bnb-smart-chain/developers/wallet-configuration/).

The main `connect.js` import provides browser-only challenge creation and verification. `connect.js/verification` exposes signature profiles, and `connect.js/wallet` exposes wallet discovery and adapters. better-connect owns its backend engine, HTTP endpoints and session storage. connect.js has no server or dapp entry point.
