// Host integration example. Validators and signers must use the host's chain SDKs.
// This file contains no keys, signing implementation, RPC provider or automatic approval.
import {
	chains,
	OperationDispatcher,
	createOperation,
	operationAccounts,
	withWalletValidation,
} from '../dist/browser/index.js';

/** host.accounts is the existing Connect AccountProvider.
 * host.approve must show the request, trusted context.origin and decoded transaction.
 * validateOperation must fully validate the native payload with the appropriate SDK. */
export function createExampleOperations(host) {
	const definitions = [
		[chains.ethereum, 'wallet.signTransaction', host.signEvm],
		[chains.bitcoin, 'wallet.signPsbt', host.signPsbt],
		[chains.solana, 'wallet.signTransaction', host.signSolana],
		[chains.core, 'wallet.signTransaction', host.signCore],
	];
	return new OperationDispatcher({
		accounts: host.accounts,
		approve: host.approve,
		adapters: definitions.map(([chain, method, sign]) =>
			withWalletValidation({
				capabilities: [
					{
						namespace: chain.namespace,
						reference: chain.reference,
						methods: [method, 'wallet.getAccounts', 'chain.getBalance'],
					},
				],
				validateAccount: host.validateAccount,
				validateOperation: host.validateOperation,
				handlers: {
					[method]: sign,
					'wallet.getAccounts': operationAccounts(host.accounts, chain),
					'chain.getBalance': host.getBalance,
				},
			}),
		),
	});
}

/** Caller supplies existing Connect account identities and real native transaction data.
 * EVM transaction is its native object; Core is its own native object (e.g. energy).
 * Solana transaction and Bitcoin PSBT are their native serialized base64 values. */
export function exampleRequests({
	evm,
	bitcoin,
	solana,
	core,
	evmTransaction,
	psbt,
	solanaTransaction,
	coreTransaction,
}) {
	const make = (operation, account, params) =>
		createOperation({
			operation,
			chain: { namespace: account.namespace, reference: account.reference },
			account,
			params,
			metadata: { application: 'Example dapp' },
		});
	return [
		make('wallet.signTransaction', evm, { transaction: evmTransaction }),
		make('wallet.signPsbt', bitcoin, { psbt, encoding: 'base64' }),
		make('wallet.signTransaction', solana, {
			transaction: solanaTransaction,
			encoding: 'base64',
		}),
		make('wallet.signTransaction', core, { transaction: coreTransaction }),
		make('chain.getBalance', evm, { address: evm.address }),
	];
}
// Dapp: await requestOperation(transport, request).
// Wallet: await dispatcher.dispatchJson(receivedJson, authenticatedTransportOrigin).
// For encrypted channels use OperationCipher.openRequest / sealResponse around dispatch.
