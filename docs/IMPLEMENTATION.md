# Implementation plan

1. Define Connect v1, strict schemas, canonical messages and shared vectors in connect.js.
2. Build browser profile verification and single-use in-memory requests in connect.js; keep backend transitions, endpoints and session cookies in better-connect.
3. Port wallet behavior to Dart, including lifecycle, transport and explicit approval.
4. Exercise cryptographic substitution attacks, concurrency, cross-language bytes and real Better Auth sessions.
5. Add release automation, issue templates, examples and platform documentation.

Research: CAIP-122 provides field vocabulary; Ethereum uses a valid EIP-4361 message with Connect bindings in Resources. Other profiles use a fixed ASCII line format, never JSON serialization. Ed448 = -53; Ed25519 = -19 (IANA/RFC9864). XCB address derivation is `SHA3-256(publicKey)[12:]` plus network prefix and ICAN checksum in go-core. No XCB registration was found in the CAIP namespace registry: use explicitly local namespace core, not an asserted registered CAIP identifier. Generic Ed25519 uses an explicitly raw-key identity. Bitcoin support will be limited to BIP322 simple P2WPKH. Wallet signing remains delegated to host implementations.

Sources:

- <https://better-auth.com/docs/plugins/siwe>
- <https://better-auth.com/docs/concepts/plugins>
- <https://standards.chainagnostic.org/CAIPs/caip-2>
- <https://standards.chainagnostic.org/CAIPs/caip-10>
- <https://standards.chainagnostic.org/CAIPs/caip-122>
- <https://www.iana.org/assignments/cose/cose.xhtml>
- <https://www.rfc-editor.org/rfc/rfc9864.html>
- <https://raw.githubusercontent.com/core-coin/go-core/master/crypto/crypto.go>
- <https://raw.githubusercontent.com/core-coin/go-core/master/common/types.go>
- <https://cip.coreblockchain.net/cip/core/cip-98/>
- <https://eips.ethereum.org/EIPS/eip-191>
- <https://eips.ethereum.org/EIPS/eip-4361>
- <https://eips.ethereum.org/EIPS/eip-1271>
- <https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki>
- <https://docs.flutter.dev/ui/navigation/deep-linking>
- <https://developer.android.com/training/app-links/create-deeplinks>
- <https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app>
- <https://pub.dev/packages/cryptography>
- <https://pub.dev/packages/app_links>
