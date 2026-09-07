# Changelog

## 0.1.2

- Publish npm when a GitHub Release is published in the app.
- Remove duplicate GitHub Release creation from the publishing workflow.

## 0.1.1

- Bump the connect-protocol npm package to 0.1.1 for the coordinated Connect release.
- Retain the CORE License.

## 0.1.0

- Implement browser-only Connect authentication through the main `connect.js` import, with in-memory challenges, local verification, explicit wallet approval and single-use consumption.
- Support fourteen named blockchains, including Core Blockchain Ed448, plus Bitcoin legacy and XRP Ed25519 proof variants. Provide extensible signature profiles and shared conformance fixtures.
- Add wallet discovery, Ethereum/Solana/Cardano/TRON adapters and Core/native wallet bridges, including mainnet and Devin support.
- Add self-contained challenge/proof exchange, a static browser example, browser bundles and TypeScript declarations. No server engine, request store, HTTP client, dapp entry or browser alias is included.
- Validate installed packages in Chromium, with networking and persistent storage disabled. Include security tests, release workflows, issue templates and CORE License.
