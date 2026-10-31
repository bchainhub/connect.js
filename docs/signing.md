# Signing and permissions

Signing methods require an explicitly connected adapter and the wallet's own approval.
Explicit account options are checked against available accounts when the adapter
provides account listing. The dispatcher does not select a different wallet after a
rejection or failure. No private key or seed phrase API is provided.

EVM `signMessage` encodes a string as UTF-8 bytes (or accepts bytes), then hex-encodes
for `personal_sign([messageHex, account])`. Typed data uses
`eth_signTypedData_v4([account, JSON])`. With no account option, exactly one authorized
EVM account must be available. The library does not choose among multiple accounts.

Solana native message signing accepts bytes or converts strings to UTF-8. Native
transaction instances pass unchanged, including versioned transactions when the wallet
supports them. Wallet Standard signing uses explicit authorized account selection and
its declared feature interfaces. Core signing uses the host's native provider; the
existing Connect Ed448 authentication signing path remains separate and unchanged.

Bitcoin and Litecoin PSBT methods accept native strings or {psbt, options}; batch signing accepts native arrays or {psbts, options}. Message variants accept {message,type} when the native API supports that signature. Cardano signData accepts
`{address, payload}` as CBOR/hex strings for its native two-argument call. Aptos message
objects, TON data requests and NEAR NEP-413-style objects retain their native shapes.

Ethereum personal-message verification is implemented locally in both libraries. JavaScript also verifies Core personal signatures using the Core prefix, SHA3 and the 171-byte Ed448 signature/public-key format. Flutter Core verification and contract-account verification need native handlers. Typed-data hashing/signing remains with the wallet: Core CIP-712 requires domain.networkId and 22-byte addresses. Payload network conflicts and non-string/non-byte messages are rejected before RPC signing.

Monero and Zcash signing uses only the native methods declared by the selected
wallet/SDK. No Ethereum prefix, Bitcoin message format, transparent/shielded conversion
or PSBT implementation is synthesized for either blockchain.

Wallet Standard transactions use serialized bytes and an explicitly chosen per-request
network when multiple chains are supported. Account feature support is checked before
signing. Legacy injected Solana providers retain native transaction instances. No
native batch broadcast is disguised as a sign-only operation.
