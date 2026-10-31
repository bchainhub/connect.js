import {
	sameWalletAddress,
	assertPayloadNetwork,
	networkMatches,
	requestObject,
} from './chain-utils.js';
import { blockchainGlobals, type Blockchain } from '../providers.js';
import {
	ProviderNotFoundError,
	WalletNotConnectedError,
	UnsupportedBlockchainError,
	UnsupportedMethodError,
	NetworkMismatchError,
	ProviderDisconnectedError,
	InvalidTransactionError,
	normalizeWalletError,
} from './errors.js';
import { isMutation, requiresWalletConnection } from './adapter.js';
import {
	walletMethods,
	type NativeTransaction,
	type WalletSigningRequest,
	type WalletAdapter,
	type WalletCallOptions,
	type WalletCapabilities,
	type WalletEvent,
	type WalletMethod,
	type WalletProviderDescriptor,
} from './types.js';

const noInput = new Set([
	'getAccounts',
	'getAccount',
	'getPublicKey',
	'getChainId',
	'getNetwork',
	'getBlockNumber',
	'getGasPrice',
	'getBalance',
	'getBalances',
	'getTokenBalances',
	'getAssets',
	'getNFTs',
	'getNonce',
	'getUTXOs',
	'getAddress',
	'getAddresses',
]);
export type NoInputMethod =
	| 'getAccounts'
	| 'getAccount'
	| 'getPublicKey'
	| 'getChainId'
	| 'getNetwork'
	| 'getBlockNumber'
	| 'getGasPrice'
	| 'getBalance'
	| 'getBalances'
	| 'getTokenBalances'
	| 'getAssets'
	| 'getNFTs'
	| 'getNonce'
	| 'getUTXOs'
	| 'getAddress'
	| 'getAddresses';
type GeneratedMethods = {
	[
		M in Exclude<WalletMethod, 'connect' | 'disconnect'>
	]: M extends NoInputMethod
		? (options?: WalletCallOptions) => Promise<unknown>
		: (input: unknown, options?: WalletCallOptions) => Promise<unknown>;
};
export class UniversalWalletProvider {
	declare getAccounts: GeneratedMethods['getAccounts'];
	declare getAccount: GeneratedMethods['getAccount'];
	declare getPublicKey: GeneratedMethods['getPublicKey'];
	declare switchNetwork: GeneratedMethods['switchNetwork'];
	declare addNetwork: GeneratedMethods['addNetwork'];
	declare getChainId: GeneratedMethods['getChainId'];
	declare getNetwork: GeneratedMethods['getNetwork'];
	declare getBlockNumber: GeneratedMethods['getBlockNumber'];
	declare getBlock: GeneratedMethods['getBlock'];
	declare getCode: GeneratedMethods['getCode'];
	declare getStorage: GeneratedMethods['getStorage'];
	declare getTransaction: GeneratedMethods['getTransaction'];
	declare getTransactionReceipt: GeneratedMethods['getTransactionReceipt'];
	declare getTransactionStatus: GeneratedMethods['getTransactionStatus'];
	declare getGasPrice: GeneratedMethods['getGasPrice'];
	declare estimateGas: GeneratedMethods['estimateGas'];
	declare estimateFee: GeneratedMethods['estimateFee'];
	declare getBalance: GeneratedMethods['getBalance'];
	declare getBalances: GeneratedMethods['getBalances'];
	declare getTokenBalance: GeneratedMethods['getTokenBalance'];
	declare getTokenBalances: GeneratedMethods['getTokenBalances'];
	declare getAssets: GeneratedMethods['getAssets'];
	declare getNFTs: GeneratedMethods['getNFTs'];
	declare getNonce: GeneratedMethods['getNonce'];
	declare getUTXOs: GeneratedMethods['getUTXOs'];
	declare getAddress: GeneratedMethods['getAddress'];
	declare getAddresses: GeneratedMethods['getAddresses'];
	declare signMessage: GeneratedMethods['signMessage'];
	declare verifyMessage: GeneratedMethods['verifyMessage'];
	declare signTypedData: GeneratedMethods['signTypedData'];
	declare signTransaction: GeneratedMethods['signTransaction'];
	declare signTransactions: GeneratedMethods['signTransactions'];
	declare signAndSendTransaction: GeneratedMethods['signAndSendTransaction'];
	declare signPSBT: GeneratedMethods['signPSBT'];
	declare signPSBTs: GeneratedMethods['signPSBTs'];
	declare signData: GeneratedMethods['signData'];
	declare sendTransaction: GeneratedMethods['sendTransaction'];
	declare sendRawTransaction: GeneratedMethods['sendRawTransaction'];
	declare transfer: GeneratedMethods['transfer'];
	declare transferToken: GeneratedMethods['transferToken'];
	declare transferNFT: GeneratedMethods['transferNFT'];
	declare prepareTransaction: GeneratedMethods['prepareTransaction'];
	declare simulateTransaction: GeneratedMethods['simulateTransaction'];
	declare estimateTransactionFee: GeneratedMethods['estimateTransactionFee'];
	declare waitForTransaction: GeneratedMethods['waitForTransaction'];
	declare callContract: GeneratedMethods['callContract'];
	declare readContract: GeneratedMethods['readContract'];
	declare writeContract: GeneratedMethods['writeContract'];
	declare sendContractTransaction: GeneratedMethods['sendContractTransaction'];
	declare deployContract: GeneratedMethods['deployContract'];
	declare estimateContractGas: GeneratedMethods['estimateContractGas'];
	declare encodeContractCall: GeneratedMethods['encodeContractCall'];
	declare decodeContractResult: GeneratedMethods['decodeContractResult'];
	declare getContractEvents: GeneratedMethods['getContractEvents'];
	declare getTokenMetadata: GeneratedMethods['getTokenMetadata'];
	declare getTokenAllowance: GeneratedMethods['getTokenAllowance'];
	declare approveToken: GeneratedMethods['approveToken'];
	declare watchAsset: GeneratedMethods['watchAsset'];
	declare addToken: GeneratedMethods['addToken'];

	private readonly adapters = new Map<string, WalletAdapter>();
	private readonly selected = new Map<Blockchain, string>();
	private active?: WalletAdapter;
	private readonly unsubscribers = new Map<string, () => void>();
	private readonly listeners = new Map<
		WalletEvent,
		Set<(value: unknown) => void>
	>();
	private readonly pending = new Set<string>();
	private readonly consumed = new Set<string>();
	private connecting = false;
	private readonly pendingConnections = new Map<
		string,
		{ activate: boolean; network?: string | number }
	>();
	private disposed = false;
	constructor(adapters: readonly WalletAdapter[] = []) {
		adapters.forEach((adapter) => this.registerProvider(adapter));
	}
	registerProvider(adapter: WalletAdapter): void {
		if (this.disposed)
			throw new ProviderDisconnectedError('Provider API was disposed.');
		if (!Object.hasOwn(blockchainGlobals, adapter.blockchain))
			throw new UnsupportedBlockchainError('Unsupported blockchain.');
		const key = this.key(adapter);
		const existing = this.adapters.get(key);
		if (existing) {
			if (existing.nativeProvider === adapter.nativeProvider) {
				if (existing !== adapter) adapter.dispose();
				return;
			}
			throw new ProviderNotFoundError(
				'Provider identifier is already registered.',
			);
		}
		if (
			[...this.adapters.values()].some(
				(a) =>
					a.blockchain === adapter.blockchain &&
					a.nativeProvider === adapter.nativeProvider,
			)
		) {
			adapter.dispose();
			return;
		}
		this.adapters.set(key, adapter);
		this.unsubscribers.set(
			key,
			adapter.subscribe((event, value) => {
				const pending = this.pendingConnections.get(key);
				if (event === 'disconnect') this.pendingConnections.delete(key);
				if (
					event === 'connect' &&
					pending &&
					!this.connecting &&
					adapter.connected
				) {
					this.pendingConnections.delete(key);
					void (async () => {
						if (pending.network !== undefined)
							await this.checkNetwork(adapter, pending.network);
						if (this.disposed || !adapter.connected) return;
						if (!this.active || pending.activate) {
							this.active = adapter;
							this.emit('connect', {
								blockchain: adapter.blockchain,
								providerId: adapter.id,
								value,
							});
						}
					})().catch((error) => {
						adapter.resetConnection?.();
						return this.emit('disconnect', {
							blockchain: adapter.blockchain,
							providerId: adapter.id,
							value: error,
						});
					});
					return;
				}
				if (this.active !== adapter || (event === 'connect' && this.connecting))
					return;
				if (
					event === 'disconnect' ||
					(event === 'accountsChanged' &&
						Array.isArray(value) &&
						value.length === 0)
				)
					this.active = undefined;
				this.emit(event, {
					blockchain: adapter.blockchain,
					providerId: adapter.id,
					value,
				});
				if (event === 'chainChanged')
					this.emit('networkChanged', {
						blockchain: adapter.blockchain,
						providerId: adapter.id,
						value,
					});
			}),
		);
		this.emit('providerChanged', {
			blockchain: adapter.blockchain,
			providerId: adapter.id,
			available: true,
		});
	}
	unregisterProvider(blockchain: Blockchain, id: string): void {
		const key = `${blockchain}:${id}`;
		const adapter = this.adapters.get(key);
		if (!adapter) return;
		this.unsubscribers.get(key)?.();
		this.unsubscribers.delete(key);
		this.adapters.delete(key);
		if (this.active === adapter) {
			this.active = undefined;
			this.emit('disconnect', { blockchain, providerId: id });
		}
		if (this.selected.get(blockchain) === id) this.selected.delete(blockchain);
		adapter.dispose();
	}
	private key(adapter: WalletAdapter) {
		return `${adapter.blockchain}:${adapter.id}`;
	}
	private resolve(options: WalletCallOptions = {}): WalletAdapter {
		if (this.disposed)
			throw new ProviderDisconnectedError('Provider API was disposed.');
		const blockchain = options.blockchain ?? this.active?.blockchain;
		if (blockchain && !Object.hasOwn(blockchainGlobals, blockchain))
			throw new UnsupportedBlockchainError('Unsupported blockchain.');
		const candidates = [...this.adapters.values()].filter(
			(a) => !blockchain || a.blockchain === blockchain,
		);
		const id =
			options.providerId ??
			(blockchain ? this.selected.get(blockchain) : undefined);
		if (id) {
			const adapter = candidates.find((a) => a.id === id);
			if (!adapter)
				throw new ProviderNotFoundError('Selected provider is unavailable.');
			return adapter;
		}
		if (candidates.length !== 1)
			throw new ProviderNotFoundError(
				candidates.length
					? 'Select a wallet explicitly.'
					: 'No compatible wallet provider found.',
			);
		return candidates[0];
	}
	getProviders(blockchain?: Blockchain): readonly WalletProviderDescriptor[] {
		return Object.freeze(
			[...this.adapters.values()]
				.filter((a) => !blockchain || a.blockchain === blockchain)
				.map((a) =>
					Object.freeze({
						id: a.id,
						blockchain: a.blockchain,
						info: a.info,
						connected: a.connected,
						capabilities: a.getCapabilities(),
					}),
				),
		);
	}
	getProvider(blockchain?: Blockchain, providerId?: string): WalletAdapter {
		return this.resolve({ blockchain, providerId });
	}
	getConnectedProvider(): WalletAdapter | undefined {
		return this.active;
	}
	getConnectedBlockchain(): Blockchain | undefined {
		return this.active?.blockchain;
	}
	getAvailableBlockchains(): readonly Blockchain[] {
		return Object.freeze([
			...new Set([...this.adapters.values()].map((a) => a.blockchain)),
		]);
	}
	getCapabilities(options: WalletCallOptions = {}): WalletCapabilities {
		const caps = this.resolve(options).getCapabilities();
		const methods = new Set(caps.methods);
		if (methods.has('getAccounts')) {
			methods.add('getAccount');
			methods.add('getAddress');
			methods.add('getAddresses');
		}
		if (methods.has('getChainId')) methods.add('getNetwork');
		return Object.freeze({ ...caps, methods: Object.freeze([...methods]) });
	}
	isConnected(options: WalletCallOptions = {}): boolean {
		try {
			return this.resolve(options).connected;
		} catch {
			return false;
		}
	}
	selectProvider(blockchain: Blockchain, providerId: string): void {
		const adapter = this.resolve({ blockchain, providerId });
		if (this.active?.blockchain === blockchain && this.active !== adapter)
			throw new WalletNotConnectedError(
				'Disconnect the active wallet before selecting another.',
			);
		this.selected.set(blockchain, providerId);
		this.emit('providerChanged', { blockchain, providerId });
	}
	async connect(
		options: WalletCallOptions & { activate?: boolean; input?: unknown } = {},
	): Promise<unknown> {
		if (this.connecting)
			throw new InvalidTransactionError(
				'A connection request is already pending.',
			);
		const adapter = this.resolve(options);
		if (this.active && this.active !== adapter && !options.blockchain)
			throw new WalletNotConnectedError('Select the blockchain explicitly.');
		const connectedBefore = adapter.connected;
		this.connecting = true;
		this.pendingConnections.set(this.key(adapter), {
			activate: options.activate === true,
			network: options.network,
		});
		try {
			const result = await adapter.invoke('connect', options.input, options);
			this.selected.set(adapter.blockchain, adapter.id);
			if (!adapter.connected) return result;
			this.pendingConnections.delete(this.key(adapter));
			if (options.network !== undefined)
				await this.checkNetwork(adapter, options.network);
			if (this.disposed)
				throw new ProviderDisconnectedError('Provider API was disposed.');
			this.selected.set(adapter.blockchain, adapter.id);
			if (
				!this.active ||
				options.activate === true ||
				this.active === adapter
			) {
				this.active = adapter;
				this.emit('connect', {
					blockchain: adapter.blockchain,
					providerId: adapter.id,
					value: result,
				});
			}
			return result;
		} catch (error) {
			if (!connectedBefore) adapter.resetConnection?.();
			this.pendingConnections.delete(this.key(adapter));
			throw error;
		} finally {
			this.connecting = false;
		}
	}
	async disconnect(options: WalletCallOptions = {}): Promise<void> {
		if (!this.active && !options.blockchain && !options.providerId) {
			const keys = [...this.pendingConnections.keys()];
			this.pendingConnections.clear();
			for (const key of keys)
				await this.adapters.get(key)?.invoke('disconnect', undefined, {});
			return;
		}
		const adapter = this.resolve(options);
		this.pendingConnections.delete(this.key(adapter));
		await adapter.invoke('disconnect', undefined, options);
		if (this.active === adapter) this.active = undefined;
	}
	async switchBlockchain(
		blockchain: Blockchain,
		options: Omit<WalletCallOptions, 'blockchain'> = {},
	): Promise<void> {
		const adapter = this.resolve({ ...options, blockchain });
		if (!adapter.connected)
			throw new WalletNotConnectedError(
				'Connect this wallet explicitly before selecting it.',
			);
		this.active = adapter;
		this.selected.set(blockchain, adapter.id);
		this.emit('providerChanged', { blockchain, providerId: adapter.id });
	}
	private async checkNetwork(
		adapter: WalletAdapter,
		expected: string | number,
	) {
		if (adapter.networkMode === 'per-request') return;
		const methods = adapter.getCapabilities().methods;
		const method = methods.includes('getChainId')
			? 'getChainId'
			: methods.includes('getNetwork')
				? 'getNetwork'
				: undefined;
		if (!method)
			throw new UnsupportedMethodError('Cannot verify wallet network.');
		const actual = await adapter.invoke(method, undefined, {});
		if (!networkMatches(actual, expected, adapter.blockchain))
			throw new NetworkMismatchError(
				'Connected network does not match the requested network.',
			);
	}
	async execute(
		method: WalletMethod,
		input?: unknown,
		options: WalletCallOptions = {},
	): Promise<unknown> {
		if (!(walletMethods as readonly string[]).includes(method))
			throw new UnsupportedMethodError('Unknown universal method.');
		if (method === 'connect') return this.connect({ ...options, input });
		if (method === 'disconnect') return this.disconnect(options);
		const adapter = this.resolve(options);
		if (requiresWalletConnection(method) && !adapter.connected)
			throw new WalletNotConnectedError('Connect the selected wallet first.');
		if (method === 'signTypedData' && typeof input === 'string') {
			try {
				input = requestObject(JSON.parse(input));
			} catch {
				throw new InvalidTransactionError('Expected typed data JSON.');
			}
		}
		if (method === 'switchNetwork' || method === 'addNetwork') {
			if (options.network !== undefined)
				await this.checkNetwork(adapter, options.network);
		} else if (method === 'signTransactions' && Array.isArray(input)) {
			for (const tx of input) {
				const network = assertPayloadNetwork(
					tx,
					options.network,
					adapter.blockchain,
				);
				if (network !== undefined) await this.checkNetwork(adapter, network);
			}
		} else {
			const network = assertPayloadNetwork(
				input,
				options.network,
				adapter.blockchain,
			);
			if (network !== undefined) await this.checkNetwork(adapter, network);
		}
		const aliases: Partial<Record<WalletMethod, WalletMethod>> = {
			getAccount: 'getAccounts',
			getAddress: 'getAccounts',
			getAddresses: 'getAccounts',
			getNetwork: 'getChainId',
		};
		const capabilities = adapter.getCapabilities();
		const nativeMethod = capabilities.methods.includes(method)
			? method
			: aliases[method];
		if (!nativeMethod || !capabilities.methods.includes(nativeMethod))
			throw new UnsupportedMethodError(
				`${method} is unavailable for this provider.`,
			);
		const mutation = isMutation(method);
		const key = options.requestId
			? `${this.key(adapter)}:request:${options.requestId}`
			: `${this.key(adapter)}:${method}:${fingerprint(input)}`;
		if (
			mutation &&
			(this.pending.has(key) || (options.requestId && this.consumed.has(key)))
		)
			throw new InvalidTransactionError('Duplicate wallet operation.');
		if (mutation && options.requestId && this.consumed.size >= 4096)
			throw new InvalidTransactionError('Request identifier limit reached.');
		if (mutation) {
			this.pending.add(key);
			if (options.requestId) this.consumed.add(key);
		}
		try {
			if (options.account && capabilities.methods.includes('getAccounts')) {
				const accounts = await adapter.invoke('getAccounts', undefined, {});
				if (
					!Array.isArray(accounts) ||
					!accounts.some(
						(a) =>
							accountAddress(a) !== undefined &&
							sameWalletAddress(
								accountAddress(a),
								options.account,
								adapter.blockchain,
							),
					)
				)
					throw new WalletNotConnectedError(
						'The requested account is not authorized.',
					);
			}
			let effective = options;
			if (
				['ethereum', 'core'].includes(adapter.blockchain) &&
				capabilities.methods.includes('getAccounts') &&
				!options.account &&
				[
					'signMessage',
					'signTypedData',
					'sendTransaction',
					'sendContractTransaction',
					'writeContract',
					'getBalance',
					'getNonce',
					'signTransaction',
					'signTransactions',
					'signAndSendTransaction',
					'approveToken',
					'transferToken',
					'transferNFT',
					'transfer',
					'deployContract',
					'prepareTransaction',
					'getTokenBalance',
					'getTokenBalances',
					'getTokenAllowance',
					'getBalances',
				].includes(method) &&
				!(
					(options.address || options.addresses?.length) &&
					method.startsWith('get')
				)
			) {
				const accounts = await adapter.invoke('getAccounts', undefined, {});
				if (
					!Array.isArray(accounts) ||
					accounts.length !== 1 ||
					!accountAddress(accounts[0])
				)
					throw new WalletNotConnectedError('Select one authorized account.');
				effective = { ...options, account: accountAddress(accounts[0]) };
			}
			if (requiresWalletConnection(method) && !adapter.connected)
				throw new WalletNotConnectedError(
					'Wallet disconnected before execution.',
				);
			const result = await adapter.invoke(nativeMethod, input, effective);
			if (
				(method === 'getAccount' || method === 'getAddress') &&
				nativeMethod === 'getAccounts'
			) {
				const accounts =
					Array.isArray(result) && options.account
						? result.filter(
								(a) =>
									accountAddress(a) !== undefined &&
									sameWalletAddress(
										accountAddress(a),
										options.account,
										adapter.blockchain,
									),
							)
						: result;
				if (!Array.isArray(accounts) || accounts.length !== 1)
					throw new WalletNotConnectedError(
						'Select an account explicitly when more than one is available.',
					);
				return method === 'getAddress'
					? accountAddress(accounts[0])
					: accounts[0];
			}
			return result;
		} catch (error) {
			throw normalizeWalletError(error);
		} finally {
			this.pending.delete(key);
		}
	}
	/** Typed discriminated request variants; raw native methods remain available. */
	executeTransaction(
		method: 'signTransaction' | 'sendTransaction' | 'signAndSendTransaction',
		request: NativeTransaction,
		options: Omit<WalletCallOptions, 'blockchain'> = {},
	): Promise<unknown> {
		return this.execute(method, request.transaction, {
			...options,
			blockchain: request.blockchain,
		});
	}
	executeSigning(
		request: WalletSigningRequest,
		options: Omit<WalletCallOptions, 'blockchain' | 'account'> = {},
	): Promise<unknown> {
		return this.execute('signMessage', request.message, {
			...options,
			blockchain: request.blockchain,
			account: request.account,
		});
	}
	/** Native RPC requires an adapter-declared method; mutations require a connected wallet. */
	async request(
		args: WalletCallOptions & { method: string; params?: unknown },
	): Promise<unknown> {
		const adapter = this.resolve(args);
		if (!adapter.getCapabilities().nativeMethods.includes(args.method))
			throw new UnsupportedMethodError(
				'Native method was not declared by this adapter.',
			);
		let payload: unknown;
		if (
			/_(sendTransaction|signTransaction|call|estimateGas|estimateEnergy)$/.test(
				args.method,
			) &&
			Array.isArray(args.params)
		)
			payload = args.params[0];
		if (/_signTypedData_v4$/.test(args.method) && Array.isArray(args.params)) {
			const raw = args.params[1];
			try {
				payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
			} catch {
				throw new InvalidTransactionError('Expected typed data JSON.');
			}
		}
		const expected = assertPayloadNetwork(
			payload,
			args.network,
			adapter.blockchain,
		);
		if (expected !== undefined) await this.checkNetwork(adapter, expected);
		// Unclassified native calls also require a connection. Read-only RPCs are narrowly identified.
		const passive =
			/^(eth|xcb|core)_(accounts|chainId|networkId|blockNumber|gasPrice|energyPrice|get[A-Z]|call|estimateGas|estimateEnergy|feeHistory|maxPriorityFeePerGas)/.test(
				args.method,
			) ||
			(adapter.blockchain === 'cardano' &&
				/^(isEnabled|getNetworkId|getUsedAddresses|getUnusedAddresses|getChangeAddress|getRewardAddresses|getUtxos|getBalance)$/.test(
					args.method,
				));
		if (!passive && !adapter.connected)
			throw new WalletNotConnectedError(
				'Connect the wallet before a native request.',
			);
		const key = args.requestId
			? `${this.key(adapter)}:request:${args.requestId}`
			: `${this.key(adapter)}:native:${args.method}:${fingerprint(args.params)}`;
		if (
			!passive &&
			(this.pending.has(key) || (args.requestId && this.consumed.has(key)))
		)
			throw new InvalidTransactionError('Duplicate native request.');
		if (!passive && args.requestId && this.consumed.size >= 4096)
			throw new InvalidTransactionError('Request identifier limit reached.');
		if (!passive) {
			this.pending.add(key);
			if (args.requestId) this.consumed.add(key);
		}
		try {
			return await adapter.request(args.method, args.params);
		} finally {
			this.pending.delete(key);
		}
	}
	on(event: WalletEvent, listener: (value: unknown) => void): this {
		const set = this.listeners.get(event) ?? new Set();
		set.add(listener);
		this.listeners.set(event, set);
		return this;
	}
	removeListener(event: WalletEvent, listener: (value: unknown) => void): this {
		this.listeners.get(event)?.delete(listener);
		return this;
	}
	private emit(event: WalletEvent, value: unknown) {
		for (const listener of [...(this.listeners.get(event) ?? [])]) {
			try {
				listener(value);
			} catch {
				/* Isolate observers. */
			}
		}
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribers.forEach((fn) => fn());
		this.adapters.forEach((a) => a.dispose());
		this.unsubscribers.clear();
		this.adapters.clear();
		this.selected.clear();
		this.pendingConnections.clear();
		this.listeners.clear();
		this.active = undefined;
	}
}
function accountAddress(value: unknown): string | undefined {
	return typeof value === 'string'
		? value
		: value && typeof value === 'object'
			? (value as { address?: string }).address
			: undefined;
}
const nativeIds = new WeakMap<object, number>();
let nextNativeId = 0;
function canonicalFingerprint(value: unknown, depth = 0): unknown {
	if (depth > 32)
		throw new InvalidTransactionError('Native payload nesting limit.');
	if (typeof value === 'bigint') return `${value}n`;
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value))
		return value.map((v) => canonicalFingerprint(v, depth + 1));
	if (value instanceof Uint8Array) return [...value];
	if (
		Object.getPrototypeOf(value) === Object.prototype ||
		Object.getPrototypeOf(value) === null
	)
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, canonicalFingerprint(v, depth + 1)]),
		);
	let id = nativeIds.get(value);
	if (!id) {
		id = ++nextNativeId;
		nativeIds.set(value, id);
	}
	return { nativeObject: id };
}
function fingerprint(value: unknown): string {
	try {
		return JSON.stringify(canonicalFingerprint(value)) ?? 'undefined';
	} catch {
		if (value && typeof value === 'object') {
			let id = nativeIds.get(value);
			if (!id) {
				id = ++nextNativeId;
				nativeIds.set(value, id);
			}
			return `native:${id}`;
		}
		return String(value);
	}
}

for (const method of walletMethods) {
	if (method === 'connect' || method === 'disconnect') continue;
	Object.defineProperty(UniversalWalletProvider.prototype, method, {
		value(
			this: UniversalWalletProvider,
			input?: unknown,
			options?: WalletCallOptions,
		) {
			return noInput.has(method)
				? this.execute(method, undefined, (input ?? {}) as WalletCallOptions)
				: this.execute(method, input, options);
		},
	});
}

declare global {
	interface Window {
		connect?: UniversalWalletProvider;
	}
}
