# Native transactions, fees and receipt waiting

Core, EVM, Solana legacy/versioned objects, Cardano CBOR, UTXO PSBTs, Aptos objects,
TON requests, NEAR actions, Monero metadata and Zcash transparent/shielded payloads
retain their native types. No cross-chain transaction conversion occurs.

Signing/submission requires an explicitly connected adapter and native authorization.
signTransaction never broadcasts. signTransactions uses native batch signing or
sequential sign-only calls. EVM/Core signAndSendTransaction maps their native
sendTransaction RPC; it never signs with a key held by this library.

Core fields are energy, energyPrice and networkId. EVM fields are gas, gasPrice or
EIP-1559 fee caps, and chainId. SDK energyLimit/gasLimit aliases are normalized to native energy/gas for RPC calls. Integer inputs are converted losslessly to RPC hex
quantities; ABI and native SDK integer values retain their types. Destination,
calldata, quantity and selected-sender checks run before mapped RPC execution.
A payload chainId/networkId or typed-data domain must match the requested/current
network. networkId objects from Core and named network objects from other SDKs are
normalized. switchNetwork/addNetwork are intentional operations and do not confuse
the target network with a current-network guard.

prepareTransaction returns unsigned native transaction fields, filling nonce and
gas/energy/price only when the corresponding native RPC is declared. simulateTransaction
uses a native read call. estimateFee/estimateTransactionFee returns {units,price,total,
unit:'native-base-units',isUpperBound}; total is units × price. EIP-1559 maxFeePerGas
produces a maximum-price bound, not a guaranteed actual fee. No oracle, L1-data/blob
fee component or chain-specific surcharge is fabricated.

getTransactionStatus reports receipt status (or pending-or-unknown). waitForTransaction
polls receipts, optionally counts confirmations, stops on disposal, fails on reversion,
and uses bounded timeoutMs (default 30000, maximum 300000) and pollIntervalMs (default
1000). Confirmation counts above one require block-number support. Waiting never
resubmits a transaction. Native confirmation/reorg guarantees remain chain-specific.

Cardano signTx returns witnesses; the host must assemble a signed transaction before
submitTx. UTXO PSBT/batch APIs retain signing options; Monero relayTx accepts native
transaction metadata; Zcash shielded payloads are not converted to Bitcoin formats.

Concurrent broadcasts are guarded at both the universal dispatcher and mapped native
submission RPC, including aliases and different object-key order. requestId blocks
repeats across mutation methods/native RPC within the selected provider instance
(maximum 4096 retained IDs). No distributed idempotency or automatic retry is claimed.
Opaque native transaction objects use identity rather than invoking custom serializers.
