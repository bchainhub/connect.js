# Wallet Operations

Connect transports signing requests; the host wallet owns and uses the private key.

`connect-protocol` defines the canonical wire format; `flutter_connect` implements the same format. Authentication remains a separate, unchanged Connect v1 exchange. The operation APIs are additive in package version 0.1.3.

```text
DApp
|
v
Connect Protocol
|
+---- Wallet Operations ----> Wallet ----> Signer
|
+---- Chain Operations -----> RPC/Node ----> Blockchain
|
+---- Capability Negotiation
|
+---- Chain Adapter
```

## Wire format

Operations reuse Connect's 64-character lowercase hexadecimal `requestId` and `{namespace, reference, address}` account identity. An account, when present, must match the envelope chain. `createOperation` (TypeScript) and `ConnectOperation` (Dart) generate cryptographically random IDs unless supplied by the caller.

```json
{
  "version": 1,
  "requestId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "operation": "wallet.signTransaction",
  "chain": { "namespace": "eip155", "reference": "1" },
  "account": { "namespace": "eip155", "reference": "1", "address": "0x1111111111111111111111111111111111111111" },
  "params": { "transaction": { "to": "0x2222222222222222222222222222222222222222", "value": "0x1" } },
  "metadata": { "application": "Example dapp" }
}
```

Success:

```json
{"version":1,"requestId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","result":{"signedTransaction":"0x..."}}
```

Rejection:

```json
{"version":1,"requestId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","error":{"code":"USER_REJECTED","message":"User rejected the operation."}}
```

`result` can be any JSON value, including null. Exactly one of `result` and `error` is required. Error `details` is an optional JSON object. Dispatchers emit fixed safe messages and omit details; transport parsers accept safe host-defined details. A malformed request without a valid ID receives `requestId: null`; all other responses retain the supplied valid ID. Unknown envelope versions yield `INVALID_PARAMS`. `parseOperationResponse` / `OperationResponse.fromJson` can enforce an expected ID; `requestOperation` always enforces it.

Requests, responses and capability lists are limited to 16,384 UTF-8 bytes and nesting depth 32. Unknown envelope fields, non-JSON values, unsafe integer numbers, and common secret field names (`privateKey`, `secretKey`, `mnemonic`, `seedPhrase`, including underscore/hyphen variants) are rejected. Use decimal or hex **strings** for balances, fees and large integers; represent bytes explicitly as base64/hex strings. These checks do not detect arbitrary secrets inside opaque strings: host handlers must return only public results. Never put keys, seeds, PINs or credentials into payloads or metadata.

## Operations and capabilities

| Methods | Behavior |
| --- | --- |
| `wallet.getAccounts` | Explicitly approved identity disclosure; `operationAccounts` reuses existing account providers without invoking their authentication signers. |
| `wallet.signMessage` | Host message signing; adapter may prepare a message for the approval callback. |
| `wallet.signTransaction`, `wallet.sendTransaction` | Native chain-specific transaction payload; host signs or signs/broadcasts. |
| `wallet.switchChain`, `wallet.addChain` | Host wallet network policy/configuration. The envelope identifies the requested target chain. |
| `wallet.signTypedData`, `wallet.signPsbt`, `wallet.signAllTransactions` | Optional specialized capabilities. Never inferred from namespace. |
| `chain.getBalance`, `chain.getTransaction`, `chain.getBlock`, `chain.estimateFee`, `chain.call` | Read-only host RPC/node handlers, without wallet approval or signer access. |

`OperationDispatcher.capabilities` is an immutable advertisement suitable for the host's authenticated session setup. Serialize it as a JSON array; Dart capabilities expose `toJson()`. `parseCapabilities` validates advertisements and rejects duplicate chain entries or methods. `supportsOperation` and `dispatcher.supports` query support by both namespace and reference.

```json
[
  {"namespace":"eip155","reference":"1","methods":["wallet.signTransaction","chain.getBalance"]},
  {"namespace":"bip122","reference":"000000000019d6689c085ae165831e93","methods":["wallet.signPsbt"]}
]
```

Only capabilities with registered handlers can be advertised. Different networks can expose different methods. Capability advertisement is not authorization: the wallet still approves each wallet/custom request. There is no implicit chain switching or automatic RPC configuration.

## Chain adapters

`OperationChainAdapter` declares capabilities, handlers, `validateAccount` and `validateOperation`. Validation must check all chain-specific transaction/message fields, network bindings and encodings before approval. An invalid address returns false; validation can throw `OperationError('INVALID_TRANSACTION')` / `OperationException('INVALID_TRANSACTION')`. Optional hooks provide message preparation, result normalization and safe error-code translation. Preparation must not sign or obtain keys. Handlers receive the same immutable validated request that approval receives. The prepared message is additional approval context; a signing handler can use the same deterministic preparation routine.

Use existing `chains` / `ConnectChains` presets for namespace/reference values. TypeScript chain definitions structurally satisfy `OperationChain`; Dart uses `OperationChain.fromChain`. Register separate capabilities for distinct references; duplicate adapter registrations for the same chain are rejected.

The extension interface supports all existing chain presets: Core, Ethereum, Base, Polygon, BNB Smart Chain, Bitcoin, Litecoin, Solana, TRON, XRP Ledger, Stellar, Cardano, Monero and Zcash. It does **not** provide native transaction parsers, signers, broadcasters or RPC clients for these chains. Those belong to the host's SDKs. An authentication signing profile does not imply any transaction capability. For example, advertise Bitcoin PSBT only if the wallet actually supports it; Litecoin/Zcash do not acquire PSBT support from sharing `bip122`.

There is no universal transaction schema. Optional TypeScript `EvmTransactionParams`, `PsbtParams`, `SolanaTransactionParams` and `CoreTransactionParams` describe outer native-payload containers only, not full SDK validation. A Bitcoin PSBT remains a PSBT; a Solana serialized transaction remains Solana data; Core uses its own transaction fields such as energy.

## Approval, accounts and dispatch

Create a dispatcher per authenticated host session with adapters, an existing `AccountProvider` / `WalletAccountProvider`, and an explicit `approve` callback. Dispatch with an origin obtained from the trusted host transport. HTTPS origin syntax is validated but does not authenticate the sender. Request `metadata` is an untrusted application claim; never derive the trusted origin from it.

The approval callback receives the full chain, account, params, metadata, trusted origin and cancellation context. Decode amount, destination, fee and network with the host chain SDK and show them with the requesting application before approval. The protocol contains no UI. All `wallet.*` and custom methods require approval; omission returns `UNAUTHORIZED`, false returns `USER_REJECTED`. Read-only `chain.*` handlers bypass approval. Do not register a signing implementation under a read-only chain method.

Signing/sending methods require an account, a successful adapter address check and membership in the existing host account provider. Account availability is checked again after approval. Authentication account `sign()` callbacks are never reused to sign arbitrary transactions. Existing account identity/profile representations remain unchanged.

Dispatch flow: parse/snapshot → bind origin and consume ID → resolve chain → check capability → check account → validate payload → prepare/approve wallet request → recheck account → execute host handler → normalize public result → validate/serialize correlated response.

A session consumes each valid ID once, including rejected/failed requests. It holds at most 4,096 IDs by default and refuses further requests rather than evicting replay protection. Host sessions must manage authorization lifetime and persist replay protection if requests must survive process restarts. Create new IDs for genuinely new operations; don't blindly retry a send after a timeout.

Default execution timeout is 30 seconds, configurable through `timeoutMs` / `timeout`. TypeScript handlers receive an `AbortSignal`; Dart handlers can check `context.isCancelled`. Late approval cannot start a handler after timeout. A host operation already in progress cannot be rolled back by Connect; the host must honor cancellation where possible and reconcile uncertain broadcasts. Creating a new dispatcher resets in-memory replay state.

## Custom operations

Register `myapp.customOperation` in both an adapter's methods and handlers. Names match `[a-z][a-z0-9]*\.[a-zA-Z][a-zA-Z0-9]*` and are at most 128 characters. `wallet.*` and `chain.*` are reserved: only the listed standard methods can be registered there. Custom operations require explicit approval and adapter validation. Unregistered names return `UNSUPPORTED_OPERATION`.

## Transport and encryption

`OperationTransport.exchange` sends and receives JSON strings; `requestOperation` validates and correlates responses. A host can implement HTTPS, extension messaging, QR/manual return, Bluetooth or any future message channel. `dispatcher.dispatchJson` is the wallet endpoint. The protocol performs no network I/O or UI by itself.

`OperationCipher(origin, requestId, pairingKey)` optionally wraps requests and responses using the existing Connect AES-256-GCM convention: 32-byte pairing key, fresh random 12-byte nonce, ciphertext followed by 16-byte authentication tag, unpadded base64url. Keys are supplied through a trusted pairing channel and are never wallet signing keys. The API keeps them private internally. Request and response directions use distinct authenticated data:

```text
connect:operation:1/{request|response}/{https-origin}/{requestId}
```

Encrypted packets have exactly `type: "connect:operation:encrypted:1"`, `kind`, `requestId`, `iv`, `ciphertext`; maximum packet size is 32,768 characters. This new type cannot be confused with authentication's `connect:response:1`. `sealRequest`/`openRequest` and `sealResponse`/`openResponse` enforce direction and correlation. Existing Dart `ConnectBleResponseBuffer` can frame these strings without change. QR and deep-link hosts carry the same packet using their own routing and trusted pairing setup; existing authentication links are not operation links. Encryption provides channel confidentiality/integrity, not wallet ownership verification. Do not log pairing material.

## Errors

Stable codes: `UNSUPPORTED_OPERATION`, `UNSUPPORTED_CHAIN`, `UNSUPPORTED_ACCOUNT`, `INVALID_PARAMS`, `INVALID_TRANSACTION`, `USER_REJECTED`, `UNAUTHORIZED`, `SIGNING_FAILED`, `BROADCAST_FAILED`, `CHAIN_UNAVAILABLE`, `TIMEOUT`, `INTERNAL_ERROR`.

Throw a protocol exception with a code, or use the adapter's `translateError` callback. Unrecognized callback exceptions are replaced with a fixed stage-appropriate message; exception contents never enter protocol responses. Approval exceptions become `UNAUTHORIZED`; signing errors become `SIGNING_FAILED`; send errors become `BROADCAST_FAILED`; read-only handler errors become `CHAIN_UNAVAILABLE`.

## Examples and compatibility

The operation examples demonstrate EVM signing, Bitcoin PSBT signing, Solana serialized transaction signing, Core transaction signing and read-only balances through explicit host callbacks. They require real SDK validation and host signing; fixture transactions are serialization examples, not broadcastable transactions.

- TypeScript/JavaScript: `examples/operations.mjs`, exported `createExampleOperations` and `exampleRequests`.
- Flutter/Dart: `example/lib/operations.dart`, `OperationsHost`, `createExampleOperations` and `exampleRequests`.

Shared `test/fixtures/operations/conformance.json` covers chain identities, all methods, custom methods, responses, capabilities and deterministic encrypted interoperability. Both implementations parse the same fixtures. Live cross-language tests also exchange freshly encrypted packets. Existing authentication and handoff tests remain regression coverage; no authentication messages, URI formats, signers, or verification profiles were changed.

Run `npm run test:operations-interop` from connect.js with flutter_connect alongside it (or run `node scripts/test-operation-interop.mjs /path/to/flutter_connect` after the build). The command compares shared fixtures and verifies freshly encrypted requests and responses in both languages. Normal validation remains `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:browser`, `npm run test:package`, `flutter analyze`, and `flutter test` in both the Flutter library and example.
