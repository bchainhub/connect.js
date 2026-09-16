import type { Account } from './protocol.js';
import { validateWalletAccount } from './wallet-validation.js';
import type { OperationChainAdapter } from './operations.js';

/** Adds format/network checks while retaining the host's stricter account policy.
 * Unsupported chains delegate to the required host validator. */
export function withWalletValidation(
	adapter: OperationChainAdapter,
): OperationChainAdapter {
	return Object.freeze({
		capabilities: adapter.capabilities,
		handlers: adapter.handlers,
		async validateAccount(account: Account) {
			return (
				validateWalletAccount(account).status !== 'invalid' &&
				(await adapter.validateAccount(account)) === true
			);
		},
		validateOperation: adapter.validateOperation.bind(adapter),
		prepareMessage: adapter.prepareMessage?.bind(adapter),
		normalizeResult: adapter.normalizeResult?.bind(adapter),
		translateError: adapter.translateError?.bind(adapter),
	});
}
