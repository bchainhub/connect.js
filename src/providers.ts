import {
	createOperation,
	OperationError,
	operationMethods,
	requestOperation,
	type OperationChain,
	type OperationTransport,
	type JsonObject,
	type ConnectOperation,
} from './operations.js';

export const blockchainGlobals = Object.freeze({
	core: 'core',
	ethereum: 'ethereum',
	solana: 'solana',
	bitcoin: 'bitcoin',
	litecoin: 'litecoin',
	cardano: 'cardano',
	aptos: 'aptos',
	ton: 'ton',
	near: 'near',
	monero: 'monero',
	zcash: 'zcash',
} as const);
export type Blockchain = keyof typeof blockchainGlobals;
export interface ProviderInfo {
	readonly uuid: string;
	readonly name: string;
	readonly rdns: string;
	readonly icon: string;
	readonly iconUrl?: string;
	readonly [key: string]: unknown;
}
export type CIP6963ProviderInfo = ProviderInfo;
export type EIP6963ProviderInfo = ProviderInfo;
export const defaultProviderIcon =
	'data:image/svg+xml,' +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="20" fill="#2458db"/><path d="M66 28H42a20 20 0 0 0 0 40h24" fill="none" stroke="white" stroke-width="10"/></svg>',
	);
export function createProviderInfo(
	input: Partial<ProviderInfo> = {},
	blockchain: Blockchain = 'core',
): Readonly<ProviderInfo> {
	const info = {
		...input,
		uuid: input.uuid ?? crypto.randomUUID(),
		name: input.name ?? 'Connect Wallet Protocol',
		rdns: input.rdns ?? 'connect.wallet',
		icon: input.icon ?? defaultProviderIcon,
	};
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			info.uuid,
		) ||
		typeof info.uuid !== 'string' ||
		typeof info.name !== 'string' ||
		!info.name ||
		info.name.length > 256 ||
		typeof info.rdns !== 'string' ||
		info.rdns.length > 253 ||
		!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
			info.rdns,
		)
	)
		throw new TypeError('Invalid provider identity');
	if (
		typeof info.icon !== 'string' ||
		info.icon.length > 262144 ||
		!(
			blockchain === 'ethereum'
				? /^data:image\//i
				: /^(data:image\/|https:\/\/|ipfs:\/\/)/i
		).test(info.icon) ||
		(info.iconUrl !== undefined &&
			(typeof info.iconUrl !== 'string' ||
				!/^(https:\/\/|ipfs:\/\/)/i.test(info.iconUrl)))
	)
		throw new TypeError('Invalid provider icon');
	return Object.freeze(info);
}
export interface InjectableProvider {
	request(args: {
		method: string;
		params?: readonly unknown[] | object;
	}): Promise<unknown>;
}
export type ProviderWindow = EventTarget & Record<string, unknown>;
/** Install only supported blockchains. Never replace another provider's globals. */
export function injectProviders(options: {
	providers: Partial<Record<Blockchain, InjectableProvider>>;
	connect: unknown;
	info?: Partial<ProviderInfo>;
	infoByBlockchain?: Partial<Record<Blockchain, Partial<ProviderInfo>>>;
	/** Other blockchains can opt in to a host-defined discovery protocol. */
	discoveryPrefixes?: Partial<Record<Blockchain, string>>;
	target?: ProviderWindow;
}) {
	const target = options.target ?? (window as unknown as ProviderWindow);
	const entries = Object.entries(options.providers).map(([key, provider]) => {
		const blockchain = key as Blockchain;
		if (
			!Object.hasOwn(blockchainGlobals, blockchain) ||
			typeof provider?.request !== 'function'
		)
			throw new TypeError('Invalid blockchain provider');
		const overrides = options.infoByBlockchain?.[blockchain];
		const info = createProviderInfo(
			{ ...options.info, ...overrides },
			blockchain,
		);
		const prefix =
			options.discoveryPrefixes?.[blockchain] ??
			(blockchain === 'core'
				? 'cip6963'
				: blockchain === 'ethereum'
					? 'eip6963'
					: undefined);
		return { blockchain, provider, info, prefix };
	});
	if (new Set(entries.map((e) => e.info.uuid)).size !== entries.length)
		throw new TypeError('Provider instances require distinct UUIDs');
	const cleanup: (() => void)[] = [];
	if (target.connect == null) {
		target.connect = options.connect;
		cleanup.push(() => {
			if (target.connect === options.connect) delete target.connect;
		});
	}
	for (const { blockchain, provider, info, prefix } of entries) {
		const key = blockchainGlobals[blockchain];
		if (target[key] == null) {
			target[key] = provider;
			cleanup.push(() => {
				if (target[key] === provider) delete target[key];
			});
		}
		if (prefix) {
			const detail = Object.freeze({ info, provider });
			const announce = () =>
				target.dispatchEvent(
					new CustomEvent(`${prefix}:announceProvider`, { detail }),
				);
			target.addEventListener(`${prefix}:requestProvider`, announce);
			cleanup.push(() =>
				target.removeEventListener(`${prefix}:requestProvider`, announce),
			);
			announce();
		}
	}
	return {
		dispose() {
			cleanup
				.splice(0)
				.reverse()
				.forEach((fn) => fn());
		},
	};
}
export interface BlockchainRoute {
	readonly chain: OperationChain;
	readonly transport: OperationTransport;
}
/** Universal operations retain chain-specific params and the dispatcher's approval checks. */
export class UniversalProvider {
	private readonly routes: Readonly<
		Partial<Record<Blockchain, BlockchainRoute>>
	>;
	constructor(
		routes: Partial<Record<Blockchain, BlockchainRoute>>,
		public defaultBlockchain: Blockchain = 'core',
	) {
		this.routes = Object.freeze(
			Object.fromEntries(
				Object.entries(routes).map(([key, route]) => [
					key,
					Object.freeze({
						chain: Object.freeze({ ...route.chain }),
						transport: route.transport,
					}),
				]),
			),
		);
	}
	async request(args: {
		method: string;
		params?: JsonObject;
		blockchain?: Blockchain;
		account?: ConnectOperation['account'];
	}) {
		const route = this.routes[args.blockchain ?? this.defaultBlockchain];
		if (!route) throw new OperationError('UNSUPPORTED_CHAIN');
		const response = await requestOperation(
			route.transport,
			createOperation({
				operation: args.method,
				chain: route.chain,
				params: args.params ?? {},
				...(args.account ? { account: args.account } : {}),
			}),
		);
		if ('error' in response) throw new OperationError(response.error.code);
		return response.result;
	}
	operation(
		method: keyof typeof operationMethods,
		params: JsonObject = {},
		options: {
			blockchain?: Blockchain;
			account?: ConnectOperation['account'];
		} = {},
	) {
		return this.request({
			...options,
			method: operationMethods[method],
			params,
		});
	}
}
