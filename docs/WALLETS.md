# Wallet integration

Import wallet adapters from `connect-protocol/wallet`. The former `connect-protocol/evm` entry point has been removed. The API is based on capabilities and signing standards, without a wallet-brand allowlist.

| Adapter / discovery | Wallet interface | Coverage |
| --- | --- | --- |
| `discoverEthereumWallets`, `ethereumAccountProvider` | EIP-6963 discovery and EIP-1193 signing | MetaMask, Phantom EVM and other wallets supplying the same interface; Ethereum, Polygon, Base, BNB and configured EVM networks |
| `getStandardWallets`, `getSolanaWallets`, `solanaStandardAccountProvider` | Wallet Standard with `solana:signMessage` | All registered wallets exposing this feature for Solana mainnet |
| `solanaAccountProvider` | Authorized `publicKey` plus `signMessage(bytes, 'utf8')` | Phantom/Solflare-style Solana providers |
| `cardanoAccountProvider` | Authorized CIP-30 API | Cardano wallets exposing getNetworkId, address getters and signData |
| `tronLinkAccountProvider` | Authorized modern TronLink-style provider | Mainnet account/chain checks and TronWeb signMessageV2 |
| `coreAccountProvider` | Connect-defined `CoreWalletBridge` | Future Core Blockchain wallets, native wallets and hardware bridges using pure Ed448 |
| `bitcoinAccountProvider` | Explicit native/SDK message-signing bridge | Bitcoin BIP-322 P2WPKH, legacy Bitcoin, Litecoin P2PKH and transparent Zcash P2PKH |
| `stellarAccountProvider` | SEP-53 signing bridge | Stellar key-address message signing |
| `moneroAccountProvider` | Spend-key SigV2 signing bridge | Monero standard/subaddress proofs |
| `rippleAccountProvider` | XRP message-signing bridge | Classic addresses with secp256k1 or Ed25519 |
| `walletAccountProvider` | WalletDriver with chain, getAccounts and sign | Additional native, browser, mobile, hardware and remote-wallet SDK integrations |

“Coverage” means compatibility with the specified interface and proof scheme, not that every wallet product or version has been tested. Some wallets lack arbitrary message signing, expose a proprietary interface, or return an unsupported address/script type. Such wallets need a bridge or a new verified signing profile; the library does not fall back to transaction signing or guess signature formats. [The chain matrix](CHAINS.md) lists exact address limits. In particular, Phantom's old Bitcoin injected provider is deprecated; Phantom support here primarily uses its Solana and Ethereum-compatible interfaces.

## Choose a wallet, then authorize it

```ts
import {
	ConnectClient, chains,
	discoverEthereumWallets, ethereumAccountProvider, requestEthereumAccounts,
	getSolanaWallets, solanaStandardAccountProvider, requestStandardAccounts,
} from 'connect-protocol/wallet';

const discovery = discoverEthereumWallets(window, updateWalletPicker);
const ethereumChoices = discovery.get();
const solanaChoices = getSolanaWallets();

// User chooses an Ethereum-compatible wallet and presses Connect:
const selected = ethereumChoices[selectedIndex];
await requestEthereumAccounts(selected.provider);
const client = new ConnectClient(ethereumAccountProvider(selected.provider, chains.ethereum));

// Or a Wallet Standard Solana wallet:
const selectedSolana = solanaChoices[selectedIndex];
await requestStandardAccounts(selectedSolana);
const solanaClient = new ConnectClient(solanaStandardAccountProvider(selectedSolana));

// Dispose EIP-6963 event listeners when the picker closes.
discovery.dispose();
```

Discovery does not request account permission or signatures. Wallet Standard registration/unregistration events are available through `getStandardWallets().on(...)`; use its returned unsubscribe callbacks. Provider names, icons and RDNS fields are untrusted presentation metadata, not authenticated brand identity. Display text safely and do not inject wallet-provided SVG as HTML.

The host owns wallet selection, permission prompts, network switching, remote pairing and trusted approval UI. Once authorized, all adapters implement the same `AccountProvider`, so QR handling remains:

```ts
const request = await client.resolve(scannedConnectUri);
// Display the domain, selected account, network and expiry.
// Only from the explicit Approve button:
await request.approve(request.accounts[0]);
```

## Phantom-style Solana

```ts
import { ConnectClient, solanaAccountProvider } from 'connect-protocol/wallet';

// provider is the Solana provider selected by the user.
await provider.connect(); // Explicit Connect-button action.
const client = new ConnectClient(solanaAccountProvider(provider));
```

The adapter handles signature-byte encoding and checks the selected account before and after signing. Wallet Standard results must report the exact unchanged canonical message and Ed25519 signature type. A wallet-added prefix is rejected because it would change Connect's signing semantics.

## Cardano and TRON

```ts
import { cardanoAccountProvider, tronLinkAccountProvider } from 'connect-protocol/wallet';

const api = await selectedCardanoWallet.enable(); // User authorization.
const cardano = cardanoAccountProvider(api);

await selectedTronProvider.request({ method: 'eth_requestAccounts' });
const tron = tronLinkAccountProvider(selectedTronProvider);
```

CIP-30 hex addresses are converted to canonical Bech32 identities. Only supported mainnet key addresses are exposed; the adapter converts signData's `{ signature, key }` into Connect's proof fields. The TronLink adapter uses the authorized `tronWeb` instance, checks `eth_chainId`, and passes canonical bytes to `signMessageV2`. Other TRON SDKs can implement `tronAccountProvider`'s bridge instead.

## Core Blockchain / XCB

Core Blockchain support is ready for a wallet implementation without assuming an unreleased provider name or RPC method. It refers to the XCB chain using Ed448 and ICAN addresses. It does not refer to the Ethereum-compatible Core DAO network.

```ts
import {
	ConnectClient, coreAccountProvider, coreChain,
	coreAddress, validateCoreAddress, verifyCoreSignature,
} from 'connect-protocol/wallet';

const bridge = {
	async getAccounts() {
		// Only return accounts already authorized for this application.
		return [{ address, publicKey, reference: '1' }];
	},
	async signConnect({ account, message, algorithm }) {
		// algorithm is 'Ed448'. Keep private keys inside your trusted wallet.
		return nativeWallet.signEd448(account.address, message);
	},
};
const client = new ConnectClient(coreAccountProvider(bridge));
// Devin uses the same bridge and cryptography with reference 3:
const devinClient = new ConnectClient(coreAccountProvider(bridge, coreChain('devin')));
```

Core cryptographic contract:

- The public key is 57 bytes; a pure RFC8032 Ed448 signature is 114 bytes.
- Sign exactly the supplied canonical UTF-8 bytes, using an empty context and no added prefix or prehash.
- Derive the 20-byte body as `SHA3-256(publicKey)[12:]`, then add the ICAN checksum and `cb` (mainnet/reference 1) or `ab` (Devin/reference 3) prefix. SHA3-256 is distinct from Ethereum's Keccak-256.
- The protocol profile remains `xcb-ed448`, with COSE algorithm `-53` and the protocol-local `core` namespace. This preserves the existing wire contract.
- The adapter derives and checks each account address from its public key, verifies the returned signature locally, and submits lowercase hex proof fields. The originating browser independently verifies the proof again.

`coreAddress`, `validateCoreAddress` and `verifyCoreSignature` work in browsers and extension code. These helpers are tested against the go-core reference address. `coreChain('mainnet')` and `coreChain('devin')` provide correctly named chain definitions. Return reference-3 accounts when using the Devin bridge, and explicitly enable that chain in BrowserConnect.

The bridge is a Connect integration contract for wallet implementers, not a claim that a released Core wallet exposes `signConnect` today. The SDK never accepts a Core private key, generates a wallet seed, or invents a generic `xcb_sign` RPC method.

## Other wallets and chains

```ts
import { walletAccountProvider, chains } from 'connect-protocol/wallet';

const accounts = walletAccountProvider({
	chain: chains.stellar,
	getAccounts: () => myWallet.authorizedAddresses(),
	async sign(address, bytes) {
		// Invoke the chain's prescribed signing method, here SEP-53.
		const signature = await myWallet.signSep53(address, bytes);
		return { signature }; // Uint8Array or the declared canonical encoding.
	},
});
```

`WalletDriver.sign` receives the selected address and canonical bytes. Bridge the actual wallet SDK/RPC explicitly: for Bitcoin use BIP-322 simple or the selected legacy signmessage method; for Monero request a spend-key SigV2 proof; for Stellar use SEP-53; for XRP return the signature plus corresponding public key. Chain-specific convenience functions configure the correct proof profile. The generic adapter normalizes byte/hex/base64 output, checks proof-size limits, and rejects an account disappearing before or after signing. Network selection and signature wrapping must be implemented correctly by native drivers; the browser verifier enforces the configured network and full proof semantics.

`combineWalletProviders(...)` composes multiple already-selected adapters. It preserves distinct wallet choices, even for the same address. It does not silently hide a failing provider. Adding a new wallet that implements an existing interface requires no cryptographic changes. Adding a new signing scheme requires its own signature verifier and tests.

## References

- [EIP-6963 provider discovery](https://eips.ethereum.org/EIPS/eip-6963)
- [Wallet Standard discovery](https://github.com/wallet-standard/wallet-standard)
- [Solana Wallet Standard features](https://github.com/solana-labs/wallet-standard)
- [Phantom Solana message signing](https://docs.phantom.com/solana/signing-a-message)
- [Phantom Bitcoin provider deprecation](https://docs.phantom.com/bitcoin/signing-a-message)
- [Cardano CIP-30](https://cips.cardano.org/cip/CIP-30)
- [TRON dapp integration](https://developers.tron.network/docs/tronlink-integration)
- [Core go-core cryptography](https://github.com/core-coin/go-core/blob/master/crypto/crypto.go)
