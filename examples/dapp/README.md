# Browser-only dapp example

This is a complete static dapp using the main `connect.js` import. It discovers wallets, requests account access, lets the user select an account, shows the exact sign-in message, obtains explicit signature approval and verifies the proof in the browser. A signed-in panel then shows the verified identity. Disconnect, account/network changes, cancellation and reload clear local state.

## Run

From the connect.js repository:

```sh
npm install --package-lock=false
npm run build
```

Serve the repository as static files on your HTTPS domain and open `/examples/dapp/index.html`. No Connect server, database, session endpoint or blockchain RPC is required. For local development, use a trusted local HTTPS certificate and a DNS name such as `connect.test`; Connect's canonical origin rules do not accept `http://localhost`, IP addresses or custom ports. Use your existing static web development setup.

Until the package is published, run `npm pack` in this repository and install the generated `.tgz` in your own dapp with `npm install /path/to/connect.js-0.1.0.tgz`.

The import map resolves `connect.js` to the built SDK. In a bundled dapp, install `connect.js`, remove the import map and keep the same JavaScript imports. For static deployment, retain the example files and the complete `dist/browser/` directory at the relative paths used by the import map, including adjacent chunks and license notices.

## Core login flow

```js
import {
	BrowserConnect,
	requestEthereumAccounts,
	ethereumAccountProvider,
	signBrowserChallenge,
	chains,
} from 'connect.js';

// Run from the Connect button after the user selects a discovered provider.
await requestEthereumAccounts(selectedProvider);
const adapter = ethereumAccountProvider(selectedProvider, chains.ethereum);
const accounts = await adapter.getAccounts();
const request = new BrowserConnect({ chains: [chains.ethereum] }).create();

// Display request.challenge and accounts in your UI.
// Run from the Sign in button after the user chooses an account.
const proof = await signBrowserChallenge(request.challenge, selectedAccount);
const identity = await request.verify(proof);
// Render your local signed-in UI using identity.
```

`app.js` demonstrates the complete flow, including stale asynchronous responses, expiration and user rejection. It does not switch wallet networks automatically. Select the desired network in both the dapp and wallet. Wallet names are untrusted display text and are never inserted as HTML.

Discovery accepts any EIP-6963 wallet with EIP-1193 message signing, covering Ethereum, Polygon, Base and BNB Smart Chain. Solana uses Wallet Standard's connect and signMessage features. It does not depend on a specific wallet brand or a single injected `window.ethereum` provider.

## Add Core Blockchain or another wallet

The example's `wallets.js` registry accepts integrations with `id`, `name`, `chains`, `authorize(chain)` and optional `onChange(callback)`. `authorize` runs only after the user clicks Connect and returns a Connect `AccountProvider`. This keeps the same account-selection and local-verification flow for additional chains.

For a Core wallet integration, add a module alongside `app.js`, import it from `app.js`, and register your host-supplied bridge:

```js
import { chains, coreAccountProvider } from 'connect.js';
import { registerWallet } from './wallets.js';

// coreBridge and requestWalletAccess are supplied by your wallet integration.
// The bridge exposes getAccounts() and signConnect() as described in WALLETS.md.
export function installCoreWallet(coreBridge, requestWalletAccess) {
	return registerWallet({
		id: 'my-core-wallet',
		name: 'My Core wallet',
		chains: [chains.core],
		async authorize() {
			await requestWalletAccess();
			return coreAccountProvider(coreBridge);
		},
	});
}
```

Core uses pure Ed448 and ICAN addresses. No fictional Core extension RPC API is assumed. The host supplies account access and signing; the SDK verifies the returned Core signature and address locally. The same registry accepts Cardano, TRON, Bitcoin, Stellar, Monero, XRP, Litecoin, Zcash and other existing [wallet adapters](../../docs/WALLETS.md). Add an `onChange` subscription when your host provides account/network/disconnection events; return its unsubscribe function.

For cross-device use, the [manual request/response example](../browser-only.html) exports the full challenge and imports the proof. QR rendering/scanning and a return channel are supplied by the host.

## State and verification

The verified identity exists only in this page's memory. This example demonstrates local dapp authentication, not a server session or authorization for protected remote resources. The SDK checks challenge freshness, origin, selected chain/profile, address ownership and one-time consumption. It does not check balances or perform transactions.

`npm run test:browser` exercises this example in Chromium using simulated wallet interfaces and real Ethereum, Core and Solana signatures. The tests do not connect to a live wallet or blockchain. Package tests repeat the example against the installed npm tarball.
