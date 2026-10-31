# Provider events and lifecycle

JS supports `on(event, listener)` and `removeListener(event, listener)` on the universal
API. Flutter exposes `Stream<ProviderEvent> events`; its browser facade also has
`on`/`removeListener`. Subscribe before connecting if the initial connection matters.

Event names: accountsChanged, chainChanged, networkChanged, connect, disconnect,
providerChanged, transactionStatusChanged. Native event subscription requires an
actual provider on/removeListener pair or a host-supplied event source. Events are
not polled or fabricated when a provider lacks them. Core/EVM events, SDK events and
Wallet Standard account changes are forwarded from their native sources.

Only events from the active provider reach universal subscribers. JS event payloads
are `{blockchain, providerId, value}`. Dart ProviderEvent.arguments starts with
blockchain name and provider ID, followed by native arguments. A chainChanged event
also emits networkChanged. Empty accountsChanged or disconnect clears the active
connection; a later account list never silently reconnects the wallet.

Selection and successful active connections emit providerChanged/connect respectively.
Disconnect clears local session state; if the native wallet exposes disconnect it is
called, otherwise the session is only forgotten locally. EIP-1193 has no mandatory
permission revocation method. Do not treat local disconnection as wallet permission
revocation. Cleanup is idempotent and removes owned subscriptions; pending wallet
requests cannot necessarily be cancelled by the library.

Example JS: `api.on('accountsChanged', event => render(event.value))`.
Example Dart: `final subscription = api.events.listen(renderEvent)`; cancel the
subscription when its view is disposed. Call discovery/API disposal at final teardown.

TON Connect SDK links remain pending: returning a connection URL alone does not mark
the wallet authorized. onStatusChange/account confirmation activates a previously
requested connection, applying its network guard. An unsolicited SDK status event
never chooses a wallet. Native Dart TON SDK wrappers set asynchronousConnection: true
and forward ProviderEvent('connect', ...) only after authorization.
