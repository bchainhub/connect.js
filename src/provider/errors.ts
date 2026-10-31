export class WalletProviderError extends Error {
	readonly providerCode?: unknown;
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'WalletProviderError';
		this.providerCode =
			options?.cause &&
			typeof options.cause === 'object' &&
			'code' in options.cause
				? options.cause.code
				: undefined;
	}
}
export class ProviderNotFoundError extends WalletProviderError {
	override name = 'ProviderNotFoundError';
}
export class WalletNotConnectedError extends WalletProviderError {
	override name = 'WalletNotConnectedError';
}
export class UnsupportedBlockchainError extends WalletProviderError {
	override name = 'UnsupportedBlockchainError';
}
export class UnsupportedMethodError extends WalletProviderError {
	override name = 'UnsupportedMethodError';
}
export class UnsupportedCapabilityError extends UnsupportedMethodError {
	override name = 'UnsupportedCapabilityError';
}
export class UserRejectedRequestError extends WalletProviderError {
	override name = 'UserRejectedRequestError';
}
export class InvalidTransactionError extends WalletProviderError {
	override name = 'InvalidTransactionError';
}
export class NetworkMismatchError extends WalletProviderError {
	override name = 'NetworkMismatchError';
}
export class ProviderDisconnectedError extends WalletProviderError {
	override name = 'ProviderDisconnectedError';
}
export class TransactionFailedError extends WalletProviderError {
	override name = 'TransactionFailedError';
}
export function normalizeWalletError(error: unknown): WalletProviderError {
	if (error instanceof WalletProviderError) return error;
	const code =
		error && typeof error === 'object' && 'code' in error
			? error.code
			: undefined;
	const options = { cause: error };
	if (
		[4001, '4001', 'USER_REJECTED', 'ACTION_REJECTED'].includes(code as never)
	)
		return new UserRejectedRequestError('Wallet request rejected.', options);
	if ([4200, -32601, 'UNSUPPORTED_METHOD'].includes(code as never))
		return new UnsupportedMethodError('Wallet method is unavailable.', options);
	if (code === -32602)
		return new InvalidTransactionError(
			'Invalid wallet request parameters.',
			options,
		);
	if (code === 4901)
		return new NetworkMismatchError(
			'Wallet is not connected to this network.',
			options,
		);
	if ([4900].includes(code as never))
		return new ProviderDisconnectedError(
			'Wallet provider disconnected.',
			options,
		);
	if (code === 4100)
		return new WalletNotConnectedError(
			'Wallet authorization required.',
			options,
		);
	return new WalletProviderError('Wallet request failed.', options);
}
