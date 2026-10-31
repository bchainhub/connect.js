# Wallet discovery and selection

`installWalletProvider()` discovers native providers and installs its `api` at
`window.connect` only if that property is absent. `discoverWalletProviders()` does
the same discovery without installing a global. Both return `api`, `refresh` and
`dispose`; installation also reports `installed`. Flutter uses
`discoverWalletProviders(install: true)` or `installWalletProvider()` in browser
builds; native builds register supplied SDK adapters without globals.

Discovery never connects, enables, requests accounts, signs or broadcasts. Ethereum
and Core listeners are installed before their discovery requests. Later announcements
remain observable until disposal. Ethereum uses EIP-6963; Core uses the supplied
CIP-6963 event pair. UUID and native object deduplication prevent repeated entries.
Legacy IDs are `ethereum:legacy`, `core:legacy`, etc.; legacy `providers` arrays use
indexed IDs. Discovery announcements are preferred over the same legacy object.
Cardano CIP-30 entries have IDs such as `cardano:nami`, and `enable` runs only during
an explicit connection request. Arbitrary namespace objects are ignored.

The JS library also observes registered Solana Wallet Standard wallets. Aptos AIP-62,
TON Connect and NEAR Wallet Selector clients can be supplied as SDK adapters; this
does not install or configure those SDKs. Flutter's browser discovery currently
covers globals and EIP/CIP announcements; Wallet Standard SDK registration requires
a host adapter. `refresh` rescans delayed globals. Disposal removes owned listeners
and the owned `connect` global, preserving existing wallet globals.

`getProviders(blockchain?)` returns immutable descriptors with IDs and capabilities.
`selectProvider(blockchain, id)` selects explicitly; `connect({blockchain, providerId})`
can select and connect in one action. Multiple candidates never cause an arbitrary
choice. Changing the selected provider on the active blockchain requires disconnecting
that wallet first. Wallet permissions may persist beyond local disconnection.

Wallet publishers can separately use `injectProviders` from the earlier API. It
installs only supplied blockchain globals plus `connect` when absent, and announces
Core/Ethereum providers. Identity defaults remain `Connect Wallet Protocol` and
`connect.wallet`; UUIDv4 and an embedded icon are generated, and other metadata is
configurable. All globals identify blockchains, not specific wallets. See README.

RDNS, names, icons, UUIDs, globals and announcements are untrusted display data.
No remote icons are fetched. Never use discovery metadata as proof of wallet ownership.

References: [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963),
[CIP-30](https://cips.cardano.org/cip/CIP-0030),
[Wallet Standard](https://github.com/wallet-standard/wallet-standard).
