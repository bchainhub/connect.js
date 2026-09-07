# Browser-only Connect

`connect.js` creates challenges and verifies wallet proofs entirely in the browser. It needs no application server, database, blockchain node, RPC endpoint, Better Auth, or persistent storage. Each request lives in a JavaScript object and can be consumed once. Closing or reloading the page discards it.

The package ships a prebuilt ES module with browser compatibility code included. Import it through your bundler, or copy the entire `dist/browser/` directory into your static site and import `./browser/index.js`. Keep its adjacent JavaScript chunks and license notices. Monero's embedded WebAssembly loads on demand from a local static chunk; it does not contact a daemon. A static host only serves application files and runs no Connect backend. Monero requires WebAssembly execution to be permitted by the site or extension content security policy.

A complete static handoff page is included in [`examples/browser-only.html`](../examples/browser-only.html). Serve the repository root from a canonical HTTPS domain after `npm run build`; the page creates requests and verifies pasted wallet responses.

The [dapp example](../examples/dapp/README.md) adds wallet selection, account authorization, an explicit Sign in button, local identity state and sign-out using the main package import.

## Same browser or extension

```ts
import { BrowserConnect, signBrowserChallenge } from 'connect.js';
import { coreAccountProvider } from 'connect.js/wallet';

// Defaults to the page's HTTPS origin and all built-in chains.
const connect = new BrowserConnect();
const request = connect.create();
const provider = coreAccountProvider(myCoreWalletBridge);
const accounts = await provider.getAccounts();

// Display request.challenge and compatible accounts in trusted wallet UI.
// Only run these lines after the user explicitly approves an account:
const proof = await signBrowserChallenge(request.challenge, accounts[0]);
const account = await request.verify(proof);
// account is now a locally verified wallet identity.
```

Choose a wallet/account using the [wallet adapters](WALLETS.md). The flow is identical for any supported adapter, including Ethereum-compatible wallets, Solana Wallet Standard, Cardano, TRON, and native wallet bridges. The SDK never asks for private keys. `signBrowserChallenge` signs but does not verify; the originating page calls `request.verify` to validate the result cryptographically.

An extension can exchange the challenge and proof through its messaging API. It must obtain the relying-party origin from the browser's trusted sender/tab information, validate the sender and recipient, and pass that origin to `new BrowserConnect({ origin })` or `decodeBrowserChallenge`. Do not trust an origin simply because a message claims it. The signed protocol retains its canonical HTTPS domain requirement; extension URLs are not relying-party origins.

## QR without a backend

A short `connect://domain/connect/v1/id` link needs an external lookup transport; connect.js does not supply one. For serverless QR, transmit the **full challenge**:

```ts
// Originating browser: retain request in memory.
const challengePayload = request.exportChallenge();
// Render challengePayload as QR, or transfer it through extension messaging.
```

```ts
// Wallet: parse the scanned payload and show the challenge for approval.
import {
	decodeBrowserChallenge, signBrowserChallenge, encodeBrowserProof,
} from 'connect.js';

const challenge = decodeBrowserChallenge(scannedPayload, expectedOrigin);
// After explicit user approval:
const proof = await signBrowserChallenge(challenge, selectedWalletAccount);
const responsePayload = encodeBrowserProof(proof);
// Display a response QR, copy it, or return it over an established channel.
```

```ts
// Originating browser: scan/import the response and verify locally.
const account = await request.verify(responsePayload);
```

This is a two-way exchange. A QR scan alone cannot notify another device without a return channel. Response QR, copy/paste, or an existing peer channel needs no Connect backend. Full challenges and some proofs may exceed a single QR's capacity; use fewer requested chains or a transport with multiple/animated frames. QR rendering/scanning is supplied by the host app. Existing wallets must implement this envelope transport before they can scan it; it does not replace or alter the HTTP v1 URI parser.

The JSON envelopes are `{ "type": "connect:challenge:1", "payload": Challenge }` and `{ "type": "connect:proof:1", "payload": Proof }`. The signed challenge and proof fields remain the same Connect v1 structures. Parsers reject extra envelope fields, malformed payloads and inputs over 16,384 characters.

A self-contained QR does not authenticate the claimed website's ownership the way an HTTPS challenge fetch does. `expectedOrigin` must come from a trusted channel or the wallet user's explicit confirmation, not automatically from the scanned JSON. The initiating browser verifies against its own retained challenge, including origin, nonce, request ID, expiry, chain and signature profile.

## Lifetime and supported proofs

Requests expire after two minutes by default (configurable from one second to five minutes). `request.status` reports `PENDING`, `CONSUMED`, `CANCELLED`, or `EXPIRED`. `request.cancel()` prevents later acceptance. Concurrent verification attempts cannot consume the same request twice. Invalid signatures do not consume it. Keep the original request object: reconstructing requests from untrusted challenges defeats local replay protection.

All built-in profiles are available, with the same [chain/address restrictions](CHAINS.md) as server verification: Core Blockchain, Ethereum, Polygon, Base, Bitcoin, Solana, BNB Smart Chain, TRON, Monero, Stellar, Litecoin, XRP, Zcash and Cardano. This proves control of supported signing keys; it does not query balances, token holdings, transactions, smart-contract account state, or chain history. Custom profiles can be supplied through `ProfileRegistry` and `defineSigningProfile`.

Local verification establishes identity for the current browser application. An application protecting server resources must independently authenticate requests on that server; a browser result does not create a trusted server session. The separate better-connect package owns Better Auth endpoints and session storage; connect.js has no server implementation.

## Verification

`npm run test:browser` runs Chromium against the published browser module with API networking, WebSockets, local/session storage, IndexedDB and Cache Storage disabled. It verifies all 17 shared proof fixtures, rejects altered nonces and replay, completes a fresh Core Ed448 challenge/sign/verify exchange, and checks origin binding, cancellation, expiration and concurrent consumption. Only local application JavaScript assets are served by the test harness.
