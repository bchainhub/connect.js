# Wallet address validation

`validateWalletAccount({namespace, reference, address})` returns a safe `status`: `valid`, `invalid`, or `unsupported`. `isValidWalletAccount` returns true only for `valid`. Dart uses the existing `WalletIdentity` and `WalletValidationStatus` enum. The helpers never rewrite the account identity or expose upstream exception messages.

The integrations pin `blockchain-wallet-validator` 1.2.1 and `flutter_wallet_validator` 0.1.4. Explicit namespace/reference mapping prevents automatic network detection or ENS/domain acceptance. Address validity does not prove ownership, account availability, selected network, or transaction safety. Existing signature verification and host approval remain required.

## Operation adapters

Wrap a host adapter with `withWalletValidation(adapter)` in either library. A known-invalid address is rejected before host approval or handler execution. The existing host account validator still runs for valid addresses and for unsupported chains/formats; it remains responsible for handling those extensions. The operation examples enable this wrapper.

```ts
const dispatcher = new OperationDispatcher({
  adapters: [withWalletValidation(myChainAdapter)],
  accounts: walletAccounts,
  approve: showApproval,
});
```

For transaction destinations, call `validateWalletAccount` with the request's chain and the decoded destination address from inside `validateOperation`. Reject `invalid`; use the chain SDK for `unsupported`. Connect does not guess transaction field names or impose a universal transaction format. Resolve name-service identifiers separately before creating an account identity.

## Coverage and limitations

| Namespace/reference | Address checks |
| --- | --- |
| `core:1`, `core:3` | ICAN checksum and exact mainnet/Devin prefix, case-insensitive validation without rewriting identity |
| `eip155:<positive decimal ID>` | 20-byte hex format; mixed-case EIP-55 checksum; unchecksummed lowercase/uppercase bodies accepted |
| Bitcoin/Litecoin existing mainnet `bip122` presets | Base58Check version/length; Bech32/Bech32m witness version, program length, checksum and mainnet HRP |
| Existing Solana mainnet preset | Base58 decoding to exactly 32 bytes, without unrelated-chain prefix heuristics |
| Existing TRON and XRP presets | Address version, decoded length and checksum |
| `stellar:pubnet` | Public-account StrKey version and CRC checksum |
| Existing Cardano mainnet preset | Shelley base, enterprise and reward addresses; Bech32 checksum, header, length and network tag |

EVM addresses do not encode a chain ID. Solana, XRP and other shared address formats likewise cannot prove which network the wallet selected. Chain capabilities, session policy and the signer must enforce that binding.

Monero, Zcash, unknown chain references and Cardano pointer forms require existing host/profile validation. They are never reported as validated by this helper. Byron and other unrecognized address forms are not accepted by the mapped Cardano preset; applications needing them must supply a dedicated adapter without this wrapper. No additional testnets are inferred from an address or a boolean testnet option.

## Package compatibility checks

The TypeScript package's generic result is insufficient for every supported format: legacy Base58Check addresses, SegWit checksums and Cardano enterprise addresses need supplemental codec checks. The Flutter package also has restrictive Cardano patterns and Solana prefix heuristics. The wrappers use the packages for available checks and supplement those gaps with explicit decoding. They never turn a failed checksum into an accepted address based on a regex.

`test/fixtures/wallet-validation.json` is identical across connect.js, flutter_connect and better-connect. Its 55 cases cover existing account fixtures, corrupted checksums, wrong networks, EVM casing, Core Devin, Taproot, Cardano headers, unsupported chains and valid Solana keys beginning with `r` or `T`. Each repository runs these cases locally; operation/server tests additionally verify rejection before approval or proof verification.

## better-connect

The server applies these checks automatically in `ConnectEngine.approve`, after envelope/profile compatibility checks and before profile verification. Known-invalid accounts return `unsupportedAccount` and leave the request pending. Unsupported chains continue through the configured signing profile's validator and cryptographic proof verification. A valid address never bypasses proof verification.

better-connect exports the same `validateWalletAccount` and `isValidWalletAccount` helpers. Its adapter source and fixtures mirror connect.js while its existing immutable connect-protocol SDK pin remains unchanged; it does not depend on unpublished workspace code.
