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

Built-in chains cover Core Blockchain, Ethereum, Polygon, Base, Bitcoin, Solana, BNB Smart Chain, TRON, Monero, Stellar, Litecoin, XRP, Zcash and Cardano. See [supported wallet methods and addresses](docs/CHAINS.md) and [wallet adapters](docs/WALLETS.md). Core uses Ed448 and ICAN addresses, including mainnet and Devin; support does not depend on a released wallet brand.

See the [complete dapp example](examples/dapp/README.md) for wallet discovery, account selection, explicit signing, local verification and sign-out, including an extension point for Core wallets.

For cross-device authentication, send `request.exportChallenge()` to the wallet and return the signed proof through a response QR, copy/paste, or an existing messaging channel. Verify it with the original `request` object. A short request-ID URI does not contain enough information for offline verification. See the [browser guide](docs/BROWSER.md), [protocol](docs/PROTOCOL.md) and [static example](examples/browser-only.html).

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

Licensed under [CORE License](LICENSE). See [release setup](docs/RELEASE.md).

## Nearby wallet apps

Use [the nearby dapp example](examples/nearby/index.html) with the Flutter example. It generates a full QR/deep link and accepts Bluetooth or manually returned encrypted responses. See [transport and offline limits](docs/NEARBY.md).

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

For separate device controls, use `connectBluetoothDevice(ticket)`, `isBluetoothDeviceConnected(device)` and `disconnectBluetoothDevice(device)`. Pass `{ device }` to `receiveBluetoothResponse(ticket, { device })` to reuse or reconnect that authorized device. Without it, receiving prompts for a device and connects automatically. See [device connection lifecycle](docs/NEARBY.md#connect-a-device-explicitly-or-on-transfer).

This package is distributed under the [CORE License](LICENSE). It is not an OSI-approved license.
