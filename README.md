# Connect.js

Browser-only Connect v1 authentication and multi-chain wallet adapters. Create a challenge, obtain an explicitly approved wallet signature, and verify the proof locally. **No server, database or blockchain RPC is required.** Private keys stay in the wallet.

```sh
npm install connect-protocol
```

```ts
import { BrowserConnect, signBrowserChallenge } from 'connect-protocol';

const request = new BrowserConnect().create();
// Display request.challenge and let the user choose and approve a wallet account.
const proof = await signBrowserChallenge(request.challenge, selectedWalletAccount);
const account = await request.verify(proof);
```

The main `connect-protocol` import is the browser API. `connect-protocol/wallet` provides wallet discovery and signing adapters; `connect-protocol/verification` provides signature profiles for custom integrations. There are no `/server`, `/dapp`, `/browser` or `/evm` entry points, HTTP handlers, request stores, or built-in HTTP transport. The package publishes prebuilt browser modules and TypeScript declarations, with no Node runtime requirement or bundled Node Monero package.

Built-in chains cover Core Blockchain, Ethereum, Polygon, Base, Bitcoin, Solana, BNB Smart Chain, TRON, Monero, Stellar, Litecoin, XRP, Zcash and Cardano. See [supported wallet methods and addresses](docs/chains.md) and [wallet adapters](docs/wallets.md). Core uses Ed448 and ICAN addresses, including mainnet and Devin; support does not depend on a released wallet brand.

See the [complete dapp example](examples/dapp/README.md) for wallet discovery, account selection, explicit signing, local verification and sign-out, including an extension point for Core wallets.

For cross-device authentication, send `request.exportChallenge()` to the wallet and return the signed proof through a response QR, copy/paste, or an existing messaging channel. Verify it with the original `request` object. A short request-ID URI does not contain enough information for offline verification. See the [browser guide](docs/browser.md), [protocol](docs/protocol.md) and [static example](examples/browser-only.html).

Requests live only in memory, expire after two minutes by default, and can be consumed once. Reloading the page discards them. QR rendering/scanning and explicit user approval belong to the host application. Browser verification establishes local wallet identity; server-side sessions, when needed by a separate application, belong to that application's authentication system. The separate better-connect repository owns Better Auth integration.

```sh
npm install --package-lock=false
npx playwright install chromium
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run test:package
```

Package validation installs the tarball into a clean consumer, checks the main API and removed entry points, verifies TypeScript imports, and runs all 17 shared proof fixtures and the static example in Chromium. Network APIs and persistent storage are disabled during browser verification. Node.js is used only for development tooling.

Licensed under [CORE License](LICENSE). See [release setup](docs/release.md).

## Nearby wallet apps

Use [the nearby dapp example](examples/nearby/index.html) with the Flutter example. It generates a full QR/deep link and accepts Bluetooth or manually returned encrypted responses. See [transport and offline limits](docs/nearby.md).

```ts
import { BrowserConnect, createBrowserHandoff, receiveBluetoothResponse } from 'connect-protocol';
const request = new BrowserConnect({ origin: location.origin }).create();
const handoff = createBrowserHandoff(request);
// Render handoff.uri as QR or a connect:// link.
// In a click handler, after the wallet enables advertising:
const packet = await receiveBluetoothResponse(handoff.ticket);
const identity = await handoff.accept(packet);
// Only now show the authenticated local dapp state.
```

Other channels pass their packet directly to `handoff.accept(packet)`. No Better Auth, backend or database is needed.

For separate device controls, use `connectBluetoothDevice(ticket)`, `isBluetoothDeviceConnected(device)` and `disconnectBluetoothDevice(device)`. Pass `{ device }` to `receiveBluetoothResponse(ticket, { device })` to reuse or reconnect that authorized device. Without it, receiving prompts for a device and connects automatically. See [device connection lifecycle](docs/nearby.md#connect-a-device-explicitly-or-on-transfer).

This package is distributed under the [CORE License](LICENSE). It is not an OSI-approved license.

# Wallet Operations

Connect transports signing requests; the host wallet owns and uses the private key.

The additive Wallet Operations API standardizes versioned requests, correlated responses, per-chain capabilities and explicit host approval. `OperationDispatcher` routes wallet methods to host signers and read-only chain methods to host RPC handlers. Transactions retain their native chain formats. Reuse existing `chains` and account providers through `OperationChainAdapter`; no transaction capability is inferred from an authentication profile.

See the [canonical operation protocol and API guide](docs/operations.md) and [EVM, Bitcoin PSBT, Solana, Core and balance examples](examples/operations.mjs). `OperationTransport` supports host message channels; `OperationCipher` adds optional AES-GCM request/response pairing. Existing authentication APIs and messages remain compatible.

## Wallet address validation

`validateWalletAccount` checks addresses against an explicit Connect namespace/reference and returns `valid`, `invalid`, or `unsupported`. `isValidWalletAccount` accepts only `valid`. These checks supplement wallet ownership verification. See [coverage, adapter integration and package compatibility](docs/wallet_validation.md).

### Blockchain providers and discovery

`injectProviders` (exported from the main and `/wallet` entries) installs only the
blockchains you supply. Existing globals are preserved. Globals identify a
**blockchain, never a specific wallet**: Core → `window.core`, all EVM networks →
`window.ethereum`, Solana → `window.solana`, Bitcoin → `window.bitcoin`, Litecoin →
`window.litecoin`, Cardano → `window.cardano`, Aptos → `window.aptos`, TON →
`window.ton`, NEAR → `window.near`, Monero → `window.monero`, and Zcash →
`window.zcash`. `window.connect` is also installed when absent.
Use discovery to select wallets when another provider already occupies a global.

```typescript
import { injectProviders, UniversalProvider } from 'connect-protocol';

const connect = new UniversalProvider({
	core: { chain: { namespace: 'core', reference: '1' }, transport: coreTransport },
	ethereum: { chain: { namespace: 'eip155', reference: '1' }, transport: evmTransport },
}, 'core');
const injection = injectProviders({
	connect,
	providers: { core: coreNativeProvider, ethereum: evmNativeProvider },
	info: {
		name: 'Connect Wallet Protocol', // default when omitted
		rdns: 'connect.wallet', // default when omitted
		icon: 'data:image/png;base64,...',
		iconUrl: 'https://wallet.example/icon.png', // optional extra metadata
		// Additional metadata, including blockchain identifiers, is allowed.
	},
	infoByBlockchain: { core: { blockchain: 'core' } },
});
await connect.operation('getAccounts'); // configured Core route
await connect.operation('getBalance', { address }, { blockchain: 'ethereum' });
await connect.request({ method: 'chain.getBlock', params: { number: 'latest' } });
connect.defaultBlockchain = 'ethereum';
// On teardown: injection.dispose();
```

Each route specifies an exact namespace and network reference, including any EVM
network. Each native provider must implement its blockchain's API; injection does
not translate Ethereum RPC into other chains' RPC. The operation transports use
the existing Connect operation envelopes and wallet dispatcher, including approval
and chain-specific validation. Discovery itself never requests accounts or signs.

Universal `operation` names are `getAccounts`, `signMessage`, `signTransaction`,
`sendTransaction`, `switchChain`, `addChain`, `signTypedData`, `signPsbt`,
`signAllTransactions`, `getBalance`, `getTransaction`, `getBlock`, `estimateFee`,
and `call`. The first nine map to `wallet.*`; the remaining five map to `chain.*`.
Params and results remain blockchain-specific (see [operations](docs/operations.md)).
Signing calls also require `account` in the call options. Unsupported capabilities
return dispatcher errors; no synthetic signing or transaction conversion is implied.
A call override never changes the default. Custom operation names work with `request`.

Core announces `cip6963:announceProvider` and responds to `cip6963:requestProvider`.
Ethereum independently uses the corresponding `eip6963` events, as defined by
[EIP-6963](https://eips.ethereum.org/EIPS/eip-6963). Metadata and announcement details
are frozen, with a stable UUIDv4 per injected instance. A UUID and embedded fallback
icon are generated when omitted. If supplying UUIDs for several providers, use
`infoByBlockchain` to give each a distinct UUID. Ethereum requires a data image URI;
Core also accepts HTTPS and IPFS icons. No remote icons are fetched by this library.

`discoverCoreWallets` and `discoverEthereumWallets` from `/wallet` listen before
requesting announcements, deduplicate results, and expose `get`, `refresh`, and
`dispose`. Other chains get their requested globals; `discoveryPrefixes` and
`discoverProviders(target, onChange, prefix)` support host-defined discovery events.
Those custom events are not claimed to be standardized 6963 protocols. Wallet
metadata is untrusted display data, including RDNS and optional `iconUrl`.

### Native universal wallet API

The new `UniversalWalletProvider` adds wallet discovery, selection, connection state,
capabilities and named native operations. The existing `UniversalProvider` remains
the operation-transport client described above.

```typescript
import { installWalletProvider } from 'connect-protocol';

const discovery = installWalletProvider();
const api = discovery.api; // also window.connect when that global was absent
const wallets = api.getProviders('ethereum');
// Render wallets; call this only after the user chooses a provider ID.
async function connectWallet(providerId: string) {
	await api.connect({ blockchain: 'ethereum', providerId });
	return api.getAccounts();
}
// Optional native operations must be declared in adapterOptions.rpcMethods.
// Per-call overrides do not replace the active blockchain.
// Teardown: discovery.dispose();
```

See [wallet provider documentation](docs/wallet-provider.md) and the
[implemented blockchain capabilities](docs/blockchains.md). Unsupported operations
throw typed errors; they never select another wallet or convert transaction formats.

Ethereum and Core now include opt-in transaction signing, fee estimates, unsigned
preparation, simulation, receipt waiting, token approvals/transfers, NFT calldata and
contract deployment helpers. Configure `ethereumRpcMethods` or `coreRpcMethods` only
for methods supported by the selected wallet. Core uses its native energy/networkId,
ICAN and SHA3 formats. See the [current support matrix](docs/blockchains.md) and
[transaction details](docs/transactions.md).
