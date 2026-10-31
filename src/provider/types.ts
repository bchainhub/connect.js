import type { Blockchain, ProviderInfo } from '../providers.js';

export const walletMethods = [
	'connect',
	'disconnect',
	'getAccounts',
	'getAccount',
	'getPublicKey',
	'switchNetwork',
	'addNetwork',
	'getChainId',
	'getNetwork',
	'getBlockNumber',
	'getBlock',
	'getCode',
	'getStorage',
	'getTransaction',
	'getTransactionReceipt',
	'getTransactionStatus',
	'getGasPrice',
	'estimateGas',
	'estimateFee',
	'getBalance',
	'getBalances',
	'getTokenBalance',
	'getTokenBalances',
	'getAssets',
	'getNFTs',
	'getNonce',
	'getUTXOs',
	'getAddress',
	'getAddresses',
	'signMessage',
	'verifyMessage',
	'signTypedData',
	'signTransaction',
	'signTransactions',
	'signAndSendTransaction',
	'signPSBT',
	'signPSBTs',
	'signData',
	'sendTransaction',
	'sendRawTransaction',
	'transfer',
	'transferToken',
	'transferNFT',
	'prepareTransaction',
	'simulateTransaction',
	'estimateTransactionFee',
	'waitForTransaction',
	'callContract',
	'readContract',
	'writeContract',
	'sendContractTransaction',
	'deployContract',
	'estimateContractGas',
	'encodeContractCall',
	'decodeContractResult',
	'getContractEvents',
	'getTokenMetadata',
	'getTokenAllowance',
	'approveToken',
	'watchAsset',
	'addToken',
] as const;
export type WalletMethod = (typeof walletMethods)[number];
export const walletEvents = [
	'accountsChanged',
	'chainChanged',
	'networkChanged',
	'connect',
	'disconnect',
	'providerChanged',
	'transactionStatusChanged',
] as const;
export type WalletEvent = (typeof walletEvents)[number];
export interface WalletCallOptions {
	blockchain?: Blockchain;
	providerId?: string;
	/** Compared before execution; never implicitly switches networks. */
	network?: string | number;
	account?: string;
	/** Public read target, distinct from the authorized signing account. */
	address?: string;
	addresses?: readonly string[];
	tokens?: readonly string[];
	blockTag?: string;
	nativeOptions?: object;
	/** Reject duplicate mutations with this key during the API instance lifetime. */
	requestId?: string;
}
export type WalletQuantity = bigint | number | `0x${string}` | `${bigint}`;
export interface EvmWalletTransaction {
	readonly from?: `0x${string}`;
	readonly to?: `0x${string}`;
	readonly data?: `0x${string}`;
	readonly value?: WalletQuantity;
	readonly gas?: WalletQuantity;
	readonly gasLimit?: WalletQuantity;
	readonly gasPrice?: WalletQuantity;
	readonly maxFeePerGas?: WalletQuantity;
	readonly maxPriorityFeePerGas?: WalletQuantity;
	readonly nonce?: WalletQuantity;
	readonly type?: WalletQuantity;
	readonly chainId?: WalletQuantity;
	readonly [key: string]: unknown;
}
export interface BlockchainTransactions {
	core: object | Uint8Array;
	ethereum: EvmWalletTransaction;
	solana: object;
	bitcoin: string | object;
	litecoin: string | object;
	cardano: string | { readonly cbor: string; readonly partialSign?: boolean };
	aptos: object;
	ton: object;
	near: object;
	monero: string | object;
	zcash: string | object;
}
export type NativeTransaction = {
	[B in Blockchain]: {
		readonly blockchain: B;
		readonly transaction: BlockchainTransactions[B];
	};
}[Blockchain];
export type WalletSigningRequest = {
	[B in Blockchain]: {
		blockchain: B;
		message: string | Uint8Array;
		account?: string;
	};
}[Blockchain];
export interface WalletCapabilities {
	readonly methods: readonly WalletMethod[];
	readonly nativeMethods: readonly string[];
	readonly networks: readonly string[];
}
export interface WalletProviderDescriptor {
	readonly id: string;
	readonly blockchain: Blockchain;
	readonly info?: Readonly<ProviderInfo>;
	readonly connected: boolean;
	readonly capabilities: WalletCapabilities;
}
export interface WalletAdapter {
	readonly id: string;
	readonly blockchain: Blockchain;
	readonly nativeProvider: object;
	readonly info?: Readonly<ProviderInfo>;
	readonly connected: boolean;
	/** Per-request SDKs validate and bind the requested network in invoke(). */
	readonly networkMode?: 'active' | 'per-request';
	getCapabilities(): WalletCapabilities;
	invoke(
		method: WalletMethod,
		input: unknown,
		options: WalletCallOptions,
	): Promise<unknown>;
	request(method: string, params?: unknown): Promise<unknown>;
	subscribe(listener: (event: WalletEvent, value: unknown) => void): () => void;
	/** Clear local authorization state without revoking native wallet permissions. */
	resetConnection?(): void;
	dispose(): void;
}
export type WalletHandler = (
	input: unknown,
	options: WalletCallOptions,
) => unknown | Promise<unknown>;
