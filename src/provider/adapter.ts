import { extendNativeActions } from './compat-actions.js';
import {
	rpcWalletActions,
	coreRpcMethods,
	additionalEthereumRpcMethods,
} from './rpc-actions.js';
import { quantity, messageBytes } from './chain-utils.js';
import type { Blockchain, ProviderInfo } from '../providers.js';
import {
	InvalidTransactionError,
	ProviderDisconnectedError,
	WalletProviderError,
	TransactionFailedError,
	UnsupportedMethodError,
	WalletNotConnectedError,
	normalizeWalletError,
} from './errors.js';
import {
	walletEvents,
	type WalletAdapter,
	type WalletCapabilities,
	type WalletEvent,
	type WalletHandler,
	type WalletMethod,
} from './types.js';

type NativeObject = Record<string, unknown>;
type NativeFunction = (...args: unknown[]) => unknown;
export interface NativeAdapterOptions {
	id: string;
	info?: Readonly<ProviderInfo>;
	networks?: readonly string[];
	/** Exact RPC allowlist. Optional RPC support cannot be inferred from request(). */
	rpcMethods?: readonly string[];
	/** Explicit mappings for a wallet SDK or chain RPC dialect. */
	handlers?: Partial<Record<WalletMethod, WalletHandler>>;
	/** SDK-specific validation in addition to structural transaction checks. */
	subscribe?: (
		listener: (event: WalletEvent, value: unknown) => void,
	) => () => void;
	networkMode?: 'active' | 'per-request';
	validateTransaction?: (transaction: unknown, method: WalletMethod) => void;
}
export const ethereumRpcMethods = Object.freeze([
	'eth_requestAccounts',
	'eth_accounts',
	'eth_chainId',
	'eth_getBalance',
	'eth_sendTransaction',
	'personal_sign',
	'eth_signTypedData_v4',
	'eth_call',
	'eth_estimateGas',
	'eth_getTransactionReceipt',
	'wallet_switchEthereumChain',
	'wallet_addEthereumChain',
	'wallet_watchAsset',
	'eth_blockNumber',
	'eth_getBlockByNumber',
	'eth_getTransactionByHash',
	'eth_gasPrice',
	'eth_getTransactionCount',
	'eth_sendRawTransaction',
	'eth_getLogs',
	...additionalEthereumRpcMethods,
]);
const cardanoNativeMethods = [
	'isEnabled',
	'getNetworkId',
	'getUsedAddresses',
	'getUnusedAddresses',
	'getChangeAddress',
	'getRewardAddresses',
	'getUtxos',
	'getBalance',
	'signTx',
	'signData',
	'submitTx',
	'getCollateral',
	'getExtensions',
];
const direct: Partial<Record<WalletMethod, string>> = {
	connect: 'connect',
	disconnect: 'disconnect',
	getAccounts: 'getAccounts',
	getPublicKey: 'getPublicKey',
	getAddress: 'getAddress',
	getAddresses: 'getAddresses',
	getChainId: 'getChainId',
	getNetwork: 'getNetwork',
	switchNetwork: 'switchNetwork',
	getBalance: 'getBalance',
	getBalances: 'getBalances',
	getBlockNumber: 'getBlockNumber',
	getBlock: 'getBlock',
	getTransaction: 'getTransaction',
	getTransactionReceipt: 'getTransactionReceipt',
	getTransactionStatus: 'getTransactionStatus',
	getGasPrice: 'getGasPrice',
	estimateGas: 'estimateGas',
	estimateFee: 'estimateFee',
	getTokenBalance: 'getTokenBalance',
	getTokenBalances: 'getTokenBalances',
	getAssets: 'getAssets',
	getNFTs: 'getNFTs',
	getNonce: 'getNonce',
	verifyMessage: 'verifyMessage',
	signData: 'signData',
	transfer: 'transfer',
	transferToken: 'transferToken',
	transferNFT: 'transferNFT',
	prepareTransaction: 'prepareTransaction',
	simulateTransaction: 'simulateTransaction',
	estimateTransactionFee: 'estimateTransactionFee',
	waitForTransaction: 'waitForTransaction',
	callContract: 'callContract',
	readContract: 'readContract',
	writeContract: 'writeContract',
	sendContractTransaction: 'sendContractTransaction',
	deployContract: 'deployContract',
	estimateContractGas: 'estimateContractGas',
	encodeContractCall: 'encodeContractCall',
	decodeContractResult: 'decodeContractResult',
	getContractEvents: 'getContractEvents',
	getTokenMetadata: 'getTokenMetadata',
	getTokenAllowance: 'getTokenAllowance',
	approveToken: 'approveToken',
	watchAsset: 'watchAsset',
	addToken: 'addToken',
	getUTXOs: 'getUtxos',
	signMessage: 'signMessage',
	signTypedData: 'signTypedData',
	signTransaction: 'signTransaction',
	signTransactions: 'signAllTransactions',
	signAndSendTransaction: 'signAndSendTransaction',
	sendTransaction: 'sendTransaction',
	signPSBT: 'signPsbt',
	signPSBTs: 'signPsbts',
	sendRawTransaction: 'sendRawTransaction',
};
const passive = new Set<WalletMethod>([
	'getAccounts',
	'getAccount',
	'getAddress',
	'getAddresses',
	'getPublicKey',
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
	'verifyMessage',
	'callContract',
	'readContract',
	'simulateTransaction',
	'estimateTransactionFee',
	'waitForTransaction',
	'estimateContractGas',
	'encodeContractCall',
	'decodeContractResult',
	'getContractEvents',
	'getTokenMetadata',
	'getTokenAllowance',
]);
export function requiresWalletConnection(method: WalletMethod): boolean {
	return !passive.has(method) && !['connect', 'disconnect'].includes(method);
}
export function isMutation(method: string): boolean {
	return /^(sign|send|transfer|write|deploy|approve)/.test(method);
}
function object(value: unknown): NativeObject {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new InvalidTransactionError('Expected a native request object.');
	return value as NativeObject;
}
export function validateNativeInput(
	method: WalletMethod,
	input: unknown,
	blockchain: Blockchain,
): void {
	if (
		/(Transaction|Transactions)$/.test(method) &&
		/^(sign|send|prepare|simulate)/.test(method)
	) {
		if (
			input == null ||
			typeof input === 'function' ||
			(typeof input !== 'object' && typeof input !== 'string')
		)
			throw new InvalidTransactionError('Expected a native transaction.');
		if (typeof input === 'string' && !input)
			throw new InvalidTransactionError('Empty native transaction.');
		if (
			blockchain === 'ethereum' &&
			!['sendRawTransaction', 'signTransactions'].includes(method)
		) {
			const tx = object(input);
			for (const field of [
				'value',
				'gas',
				'gasPrice',
				'maxFeePerGas',
				'maxPriorityFeePerGas',
				'nonce',
			]) {
				if (tx[field] !== undefined) quantity(tx[field]);
			}
			if (
				tx.to !== undefined &&
				(typeof tx.to !== 'string' || !/^0x[0-9a-f]{40}$/i.test(tx.to))
			)
				throw new InvalidTransactionError('Invalid EVM destination.');
			if (
				tx.data !== undefined &&
				(typeof tx.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(tx.data))
			)
				throw new InvalidTransactionError('Invalid EVM calldata.');
		}
	}
}
/** Native provider object is retained; no transaction serialization or chain substitution. */
export function createNativeWalletAdapter(
	blockchain: Blockchain,
	nativeProvider: object,
	options: NativeAdapterOptions,
): WalletAdapter {
	let api = nativeProvider as NativeObject;
	let connected = false;
	let connectionRequested = false;
	let disposed = false;
	const handlers: Partial<Record<WalletMethod, WalletHandler>> = {};
	const listeners = new Set<(event: WalletEvent, value: unknown) => void>();
	const subscriptions: (() => void)[] = [];
	const rpcMethods = new Set(
		options.rpcMethods ??
			(blockchain === 'ethereum'
				? ['eth_requestAccounts', 'eth_accounts', 'eth_chainId']
				: blockchain === 'core'
					? ['xcb_requestAccounts', 'xcb_accounts', 'xcb_networkId']
					: []),
	);
	for (const method of rpcMethods) {
		if (
			/(private.?key|seed.?phrase|mnemonic|secret.?key)/i.test(method) ||
			(blockchain === 'ethereum' &&
				!/^(eth_|wallet_|personal_sign$|net_version$|web3_clientVersion$)/.test(
					method,
				)) ||
			(blockchain !== 'ethereum' && /^eth_/.test(method)) ||
			(blockchain !== 'ethereum' &&
				blockchain !== 'core' &&
				method === 'personal_sign')
		)
			throw new UnsupportedMethodError(
				'RPC method belongs to an incompatible provider or exposes secrets.',
			);
	}
	const has = (name: string) => typeof api[name] === 'function';
	const call = async (name: string, ...args: unknown[]): Promise<unknown> => {
		if (disposed)
			throw new ProviderDisconnectedError('Wallet adapter was disposed.');
		if (!has(name))
			throw new UnsupportedMethodError(`${blockchain}: ${name} unavailable.`);
		return (api[name] as NativeFunction).apply(api, args);
	};
	const nativeSubmissions = new Set<string>();
	const rpc = async (method: string, params?: unknown) => {
		if (disposed)
			throw new ProviderDisconnectedError('Wallet adapter was disposed.');
		if (!rpcMethods.has(method) || !has('request'))
			throw new UnsupportedMethodError(`Native RPC not declared: ${method}`);
		const submission = /_(sendTransaction|sendRawTransaction)$/.test(method);
		const key =
			method +
			':' +
			JSON.stringify(params, (_, v) =>
				typeof v === 'bigint'
					? v.toString()
					: v && typeof v === 'object' && !Array.isArray(v)
						? Object.fromEntries(
								Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
							)
						: v,
			);
		if (submission && nativeSubmissions.has(key))
			throw new InvalidTransactionError('Duplicate native submission.');
		if (submission) nativeSubmissions.add(key);
		try {
			return await call('request', {
				method,
				...(params === undefined ? {} : { params }),
			});
		} finally {
			nativeSubmissions.delete(key);
		}
	};
	const emit = (event: WalletEvent, value: unknown) => {
		if (
			event === 'connect' &&
			blockchain === 'ton' &&
			has('onStatusChange') &&
			connectionRequested &&
			!disposed
		)
			connected = true;
		if (
			event === 'disconnect' ||
			(event === 'accountsChanged' && Array.isArray(value) && !value.length)
		) {
			connected = false;
			connectionRequested = false;
		}
		for (const listener of [...listeners]) {
			try {
				listener(event, value);
			} catch {
				/* Isolate observers. */
			}
		}
	};
	const bindDirect = () => {
		for (const [method, native] of Object.entries(direct))
			if (has(native))
				handlers[method as WalletMethod] = (input) =>
					input === undefined ? call(native) : call(native, input);
	};
	bindDirect();
	if (blockchain === 'core') {
		if (has('getNetworkId')) handlers.getChainId = () => call('getNetworkId');
		if (has('getEnergyPrice'))
			handlers.getGasPrice = () => call('getEnergyPrice');
		if (has('estimateEnergy'))
			handlers.estimateGas = (input) => call('estimateEnergy', input);
	}
	if (blockchain === 'ethereum' || blockchain === 'core') {
		if (blockchain === 'ethereum' && has('request'))
			for (const key of Object.keys(handlers))
				delete handlers[key as WalletMethod];
		const mapped = rpcWalletActions({
			blockchain,
			methods: has('request') ? rpcMethods : new Set(),
			request: rpc,
			disposed: () => disposed,
			emit,
		});
		// Existing direct Core SDK methods take precedence over derived RPC helpers.
		for (const [method, handler] of Object.entries(mapped))
			if (!handlers[method as WalletMethod])
				handlers[method as WalletMethod] = handler;
	}
	if (blockchain === 'bitcoin' || blockchain === 'litecoin') {
		if (has('requestAccounts'))
			handlers.connect = () => call('requestAccounts');
		if (has('pushTx'))
			handlers.sendRawTransaction = (input) => call('pushTx', input);
	}
	if (
		['core', 'solana', 'bitcoin', 'litecoin', 'zcash', 'monero'].includes(
			blockchain,
		) &&
		has('signMessage')
	) {
		const original = handlers.signMessage!;
		handlers.signMessage = (input, opts) => {
			messageBytes(input);
			return original(input, opts);
		};
	}
	if (blockchain === 'solana') {
		if (has('signMessage'))
			handlers.signMessage = (input) =>
				call('signMessage', messageBytes(input));
		if ('publicKey' in api)
			handlers.getAccounts = () => {
				const key = api.publicKey as { toBase58?: () => string } | null;
				return key ? [key.toBase58?.() ?? String(key)] : [];
			};
		if ('publicKey' in api) handlers.getPublicKey = () => api.publicKey;
	}
	if (blockchain === 'aptos') {
		if (has('account'))
			handlers.getAccounts = async () => [await call('account')];
		if (has('network')) handlers.getNetwork = () => call('network');
		if (has('signAndSubmitTransaction'))
			handlers.signAndSendTransaction = (input) =>
				call('signAndSubmitTransaction', input);
	}
	if (blockchain === 'near') {
		if (has('signIn')) handlers.connect = (input) => call('signIn', input);
		if (has('signOut')) handlers.disconnect = () => call('signOut');
		if (has('signAndSendTransaction'))
			handlers.signAndSendTransaction = (input) =>
				call('signAndSendTransaction', input);
	}
	if (blockchain === 'cardano') {
		for (const key of Object.keys(handlers))
			delete handlers[key as WalletMethod];
		const bindCardano = () => {
			const mappings: Partial<Record<WalletMethod, string>> = {
				getAccounts: 'getUsedAddresses',
				getAddresses: 'getUsedAddresses',
				getAddress: 'getChangeAddress',
				getChainId: 'getNetworkId',
				getBalance: 'getBalance',
				getUTXOs: 'getUtxos',
				signTransaction: 'signTx',
				sendRawTransaction: 'submitTx',
			};
			for (const [method, name] of Object.entries(mappings))
				if (has(name))
					handlers[method as WalletMethod] = (input) =>
						input === undefined ? call(name) : call(name, input);
			if (has('signTx'))
				handlers.signTransaction = (input) => {
					const r =
						typeof input === 'string'
							? { cbor: input, partialSign: false }
							: object(input);
					if (
						typeof r.cbor !== 'string' ||
						!/^(?:[0-9a-f]{2})+$/i.test(r.cbor) ||
						(r.partialSign !== undefined && typeof r.partialSign !== 'boolean')
					)
						throw new InvalidTransactionError(
							'Expected Cardano transaction CBOR hex and optional partialSign boolean.',
						);
					return call('signTx', r.cbor, r.partialSign ?? false);
				};
			if (has('signTx'))
				handlers.signTransactions = async (input, opts) => {
					if (!Array.isArray(input) || !input.length)
						throw new InvalidTransactionError('Expected Cardano transactions.');
					const output = [];
					for (const tx of input)
						output.push(await handlers.signTransaction!(tx, opts));
					return output;
				};
			if (has('signData'))
				handlers.signData = (input) => {
					const r = object(input);
					return call('signData', r.address, r.payload);
				};
		};
		bindCardano();
		if (has('enable'))
			handlers.connect = async () => {
				const authorized = await call('enable');
				if (!authorized || typeof authorized !== 'object')
					throw new WalletNotConnectedError('Invalid CIP-30 API.');
				api = authorized as NativeObject;
				bindCardano();
				return handlers.getAccounts?.(undefined, {});
			};
	}
	if (blockchain === 'ton') {
		// TON Connect SDK is host-supplied; never manufacture a session or proof.
		if ('account' in api) {
			handlers.getAccounts = () => (api.account ? [api.account] : []);
			handlers.getChainId = () =>
				(api.account as NativeObject | undefined)?.chain;
		}
		if (has('signData')) handlers.signData = (input) => call('signData', input);
	}
	extendNativeActions(blockchain, handlers, has, call, (name) => api[name]);
	// Local disconnect clears this library session; it does not revoke wallet permissions.
	handlers.disconnect ??= () => undefined;
	Object.assign(handlers, options.handlers);
	const capabilities = (): WalletCapabilities =>
		Object.freeze({
			methods: Object.freeze(Object.keys(handlers) as WalletMethod[]),
			nativeMethods: Object.freeze([
				...(has('request') ? rpcMethods : []),
				...(blockchain === 'cardano' ? cardanoNativeMethods.filter(has) : []),
			]),
			networks: Object.freeze([...(options.networks ?? [])]),
		});
	if (blockchain === 'ton' && has('onStatusChange')) {
		try {
			const unsubscribe = (api.onStatusChange as NativeFunction).call(
				api,
				(wallet: unknown) => {
					if (!connectionRequested || disposed) return;
					if (
						wallet &&
						typeof wallet === 'object' &&
						(wallet as NativeObject).account
					)
						emit('connect', wallet);
					else emit('disconnect', wallet);
				},
			);
			if (typeof unsubscribe === 'function')
				subscriptions.push(unsubscribe as () => void);
		} catch {
			/* SDK controls connection errors. */
		}
	}
	if (options.subscribe) {
		try {
			subscriptions.push(options.subscribe(emit));
		} catch {
			/* Unsupported SDK event source. */
		}
	}
	for (const event of walletEvents) {
		const provider = nativeProvider as NativeObject;
		if (
			typeof provider.on === 'function' &&
			typeof provider.removeListener === 'function'
		) {
			const listener = (value: unknown) => emit(event, value);
			try {
				(provider.on as NativeFunction).call(provider, event, listener);
				subscriptions.push(() =>
					(provider.removeListener as NativeFunction).call(
						provider,
						event,
						listener,
					),
				);
			} catch {
				/* Optional event not supported by this provider. */
			}
		}
	}
	return {
		id: options.id,
		networkMode: options.networkMode ?? 'active',
		blockchain,
		nativeProvider,
		info: options.info,
		get connected() {
			return connected;
		},
		getCapabilities: capabilities,
		async invoke(method, input, opts) {
			if (disposed)
				throw new ProviderDisconnectedError('Wallet adapter was disposed.');
			if (method === 'connect') connectionRequested = true;
			if (method === 'disconnect') {
				connectionRequested = false;
				connected = false;
			}
			const handler = handlers[method];
			if (!handler)
				throw new UnsupportedMethodError(
					`${blockchain}: ${method} unavailable.`,
				);
			try {
				validateNativeInput(method, input, blockchain);
				if (
					blockchain === 'ethereum' &&
					input &&
					typeof input === 'object' &&
					'from' in input &&
					opts.account &&
					String(input.from).toLowerCase() !== opts.account.toLowerCase()
				)
					throw new InvalidTransactionError(
						'Transaction sender does not match the selected account.',
					);
				if (isMutation(method)) options.validateTransaction?.(input, method);
				const result = await handler(input, opts);
				if (disposed)
					throw new ProviderDisconnectedError('Wallet adapter was disposed.');
				if (method === 'connect') {
					connected =
						blockchain === 'ton' && has('onStatusChange')
							? connected || Boolean(api.account)
							: true;
					if (connected) emit('connect', result);
				}
				if (method === 'disconnect') {
					connected = false;
					emit('disconnect', result);
				}
				return result;
			} catch (error) {
				if (method === 'connect') connectionRequested = false;
				const normalized = normalizeWalletError(error);
				if (
					/^(send|transfer|write|deploy)/.test(method) &&
					normalized.constructor === WalletProviderError
				)
					throw new TransactionFailedError('Native transaction failed.', {
						cause: error,
					});
				throw normalized;
			}
		},
		async request(method, params) {
			if (disposed)
				throw new ProviderDisconnectedError('Wallet adapter was disposed.');
			try {
				if (
					blockchain === 'cardano' &&
					cardanoNativeMethods.includes(method) &&
					has(method)
				)
					return await call(
						method,
						...(Array.isArray(params)
							? params
							: params === undefined
								? []
								: [params]),
					);
				return await rpc(method, params);
			} catch (error) {
				throw normalizeWalletError(error);
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		resetConnection() {
			connected = false;
			connectionRequested = false;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			connectionRequested = false;
			subscriptions.splice(0).forEach((fn) => {
				try {
					fn();
				} catch {
					/* Isolate native cleanup. */
				}
			});
			listeners.clear();
			connected = false;
		},
	};
}
export { coreRpcMethods };
