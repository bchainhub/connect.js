# Errors

| Class | Meaning |
| --- | --- |
| ProviderNotFoundError | Missing provider or ambiguous wallet selection |
| WalletNotConnectedError | Connect first, select an account, or account is not authorized |
| UnsupportedBlockchainError | Invalid blockchain identifier (Dart uses an enum) |
| UnsupportedMethodError | Native/universal method unavailable or undeclared |
| UnsupportedCapabilityError | More specific unsupported-capability error available to host adapters |
| UserRejectedRequestError | Native request rejected, including EVM 4001 |
| InvalidTransactionError | Invalid native input, duplicate submission or invalid EVM fields |
| NetworkMismatchError | Expected network mismatch or EVM 4901 |
| ProviderDisconnectedError | Disposed/disconnected provider, including EVM 4900 |
| TransactionFailedError | Native transaction submission failed, or a host reports a native failure |
| WalletProviderError (JS) / WalletProviderException (Dart) | Other native wallet failure |

Native -32601/4200 map to UnsupportedMethodError; -32602 maps to InvalidTransactionError.
Unclassified failures during send/transfer/write/deploy are wrapped as TransactionFailedError; other native failures retain the general provider error.
Errors preserve original codes in `providerCode` and original causes when available.
Hosts may throw the typed errors directly; they are retained. Flutter's JS facade
rejects with JS Error objects carrying the typed error name and native code when known.
Native request errors never trigger retries, alternative wallets or network switches.

Use typed checks rather than parsing wallet messages. Discovery ignores malformed
announcements and incompatible globals without prompting. RDNS is not authenticated.
