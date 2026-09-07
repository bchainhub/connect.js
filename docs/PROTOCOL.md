# Connect v1 browser protocol

The browser creates a random request ID and nonce, records its HTTPS origin, chooses acceptable chain/signature profiles, and retains the challenge in memory. A wallet displays the request, obtains explicit user approval, and signs the canonical bytes. The originating browser verifies the proof against its retained challenge and consumes the request once.

## Challenge and proof

A challenge contains `version`, `requestId`, `nonce`, `domain`, `origin`, `issuedAt`, `expiresAt`, and `requirements`. IDs and nonces are 32 random bytes encoded as lowercase hex. Each requirement pins `namespace`, `reference`, `profile` and `alg`. Schemas reject extra fields, malformed identifiers and noncanonical timestamps. Lifetimes are limited to five minutes; the default is two minutes.

A proof contains `requestId`, `account`, `profile`, `alg`, `signature`, and an optional `publicKey` where required by the profile. The account is a namespace/reference/address tuple. The selected account and proof scheme must match an advertised requirement. Verification validates address encoding, network and cryptographic ownership, then rechecks expiry and state before consumption. Concurrent verification attempts cannot consume a request twice; cancellation also prevents acceptance. An invalid signature does not consume the challenge.

## Signed messages

Most profiles sign the following fixed UTF-8 text using LF separators, with no trailing newline:

```text
Connect Authentication
Version: 1
Domain: <domain>
URI: <origin>
Account: <namespace>:<reference>:<address>
Profile: <profile>
Algorithm: <integer or none>
Nonce: <nonce>
Request ID: <requestId>
Issued At: <issuedAt>
Expiration Time: <expiresAt>
```

Ethereum-compatible profiles use EIP-4361 (SIWE), with Connect account/profile/algorithm bindings in Resources. Chain-specific signing wrappers and address restrictions are defined in [CHAINS.md](CHAINS.md). Signers must not silently substitute a prefix, hash, account, chain, or algorithm.

## Transport

The browser API exchanges complete challenge/proof JSON envelopes through an application-selected channel. See [browser transport and QR examples](BROWSER.md). A cross-device scan needs a return channel: a response QR, copy/paste or existing peer messaging. The SDK contains no HTTP challenge fetcher, server endpoints, polling client or session redemption API.

The envelope types are `connect:challenge:1` and `connect:proof:1`, each with a `payload` containing the corresponding Connect v1 object. Parsers reject extra envelope fields and input over 16,384 characters. QR rendering, scanning and framing are host responsibilities.

The lower-level `ConnectClient` lifecycle accepts an explicit `ConnectNetwork` callback adapter; it has no default HTTP implementation. `parseConnectUri` and `UriTransport` remain syntax utilities for integrations that provide their own transport. Parsing a short URI neither fetches nor authenticates its challenge.

## Trust boundaries

Use `BrowserConnect.create()` and retain the original request. Do not reconstruct a trusted pending request from an incoming proof or untrusted challenge. Reloading discards state; persistent storage is not used.

A self-contained challenge asserts its origin but does not prove ownership of that website. Obtain `expectedOrigin` from a trusted extension sender or explicit wallet-user confirmation. Show the origin, account and requested operation in trusted wallet UI. A wallet signs only after explicit approval; account identity is snapshotted before the signer callback.

Local authentication proves control of a supported signing key. It does not establish token balances, transaction ownership, chain history or smart-contract wallet state. Applications with protected server resources must authenticate those resources independently. Better Auth's backend lives in the separate better-connect package.

The [conformance fixtures](../test/fixtures/conformance.json) are shared with Dart and Better Auth and cover all supported proof schemes. Chromium tests verify positive signatures, changed nonces, expiry, cancellation and replay with network APIs and persistent storage disabled.
