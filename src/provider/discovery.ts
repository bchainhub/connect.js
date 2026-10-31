import { messageBytes } from './chain-utils.js';
import { InvalidTransactionError, WalletNotConnectedError } from './errors.js';
import { getWallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import {
	blockchainGlobals,
	createProviderInfo,
	type Blockchain,
	type ProviderWindow,
} from '../providers.js';
import {
	createNativeWalletAdapter,
	type NativeAdapterOptions,
} from './adapter.js';
import { UniversalWalletProvider } from './api.js';
import {
	walletMethods,
	type WalletAdapter,
	type WalletHandler,
} from './types.js';
import { ProviderNotFoundError } from './errors.js';

export interface WalletDiscoveryOptions {
	target?: ProviderWindow;
	/** Wallet-specific optional RPC declarations, keyed by discovery UUID or global ID. */
	adapterOptions?: (
		blockchain: Blockchain,
		id: string,
	) => Omit<NativeAdapterOptions, 'id' | 'info'>;
	/** Register ecosystem SDKs such as TON Connect / NEAR Wallet Selector here. */
	adapters?: readonly WalletAdapter[];
	standardWallets?: boolean;
}
/** Passive discovery; a wallet is never enabled/connected during discovery. */
export function discoverWalletProviders(options: WalletDiscoveryOptions = {}) {
	const target = options.target ?? (window as unknown as ProviderWindow);
	const api = new UniversalWalletProvider(options.adapters);
	const cleanup: (() => void)[] = [];
	let disposed = false;
	const seen = new Map<Blockchain, Set<object>>();
	const standardIds = new Map<Wallet, { blockchain: Blockchain; id: string }>();
	const register = (
		blockchain: Blockchain,
		id: string,
		provider: unknown,
		info?: ReturnType<typeof createProviderInfo>,
	) => {
		if (!provider || typeof provider !== 'object') return;
		const native = provider as Record<string, unknown>;
		if (
			![
				'request',
				'enable',
				'requestAccounts',
				'account',
				'signIn',
				...walletMethods,
			].some((name) => typeof native[name] === 'function') &&
			!('publicKey' in native) &&
			!('account' in native)
		)
			return;
		const known = seen.get(blockchain) ?? new Set<object>();
		if (known.has(provider)) return;
		try {
			const adapter = createNativeWalletAdapter(blockchain, provider, {
				...options.adapterOptions?.(blockchain, id),
				id,
				info,
			});
			// A namespace with no recognizable wallet API is not a provider.
			if (
				adapter.getCapabilities().methods.every((m) => m === 'disconnect') &&
				adapter.getCapabilities().nativeMethods.length === 0 &&
				typeof (provider as { request?: unknown }).request !== 'function'
			) {
				adapter.dispose();
				return;
			}
			api.registerProvider(adapter);
			known.add(provider);
			seen.set(blockchain, known);
		} catch {
			/* Ignore hostile or incompatible injected providers. */
		}
	};
	for (const [blockchain, prefix] of [
		['ethereum', 'eip6963'],
		['core', 'cip6963'],
	] as const) {
		const listener = (event: Event) => {
			try {
				const detail = (event as CustomEvent).detail;
				if (!detail || typeof detail.provider?.request !== 'function') return;
				const info = createProviderInfo(detail.info, blockchain);
				register(blockchain, info.uuid, detail.provider, info);
			} catch {
				/* Ignore untrusted metadata. */
			}
		};
		target.addEventListener(`${prefix}:announceProvider`, listener);
		cleanup.push(() =>
			target.removeEventListener(`${prefix}:announceProvider`, listener),
		);
	}
	const standard = () => {
		if (options.standardWallets === false) return;
		for (const wallet of getWallets().get()) {
			const blockchain = wallet.chains.some((c) => c.startsWith('solana:'))
				? 'solana'
				: undefined;
			if (!blockchain) continue;
			const known = seen.get(blockchain) ?? new Set<object>();
			if (known.has(wallet)) continue;
			try {
				const adapter = standardWalletAdapter(wallet, blockchain);
				api.registerProvider(adapter);
				standardIds.set(wallet, { blockchain, id: adapter.id });
				known.add(wallet);
				seen.set(blockchain, known);
			} catch {
				/* Incompatible feature versions are ignored. */
			}
		}
	};
	const scan = () => {
		if (disposed)
			throw new ProviderNotFoundError('Discovery has been disposed.');
		// Request announcements before legacy fallback so UUIDs remain provider IDs.
		for (const prefix of ['eip6963', 'cip6963'])
			target.dispatchEvent(new Event(`${prefix}:requestProvider`));
		for (const blockchain of Object.keys(blockchainGlobals) as Blockchain[]) {
			try {
				const provider = target[blockchainGlobals[blockchain]];
				if (
					blockchain === 'cardano' &&
					provider &&
					typeof provider === 'object'
				) {
					if (
						typeof (provider as Record<string, unknown>).enable === 'function'
					)
						register(blockchain, 'cardano:legacy', provider);
					for (const [id, wallet] of Object.entries(provider))
						if (
							wallet &&
							typeof wallet === 'object' &&
							typeof (wallet as Record<string, unknown>).enable === 'function'
						)
							register(blockchain, `cardano:${id}`, wallet);
				} else {
					const providers =
						provider && typeof provider === 'object'
							? (provider as { providers?: unknown }).providers
							: undefined;
					if (Array.isArray(providers))
						providers.forEach((p, i) =>
							register(blockchain, `${blockchain}:legacy:${i}`, p),
						);
					else register(blockchain, `${blockchain}:legacy`, provider);
				}
			} catch {
				/* A namespace getter must not break other chains. */
			}
		}
		standard();
	};
	if (options.standardWallets !== false) {
		cleanup.push(getWallets().on('register', standard));
		cleanup.push(
			getWallets().on('unregister', (...wallets) => {
				for (const wallet of wallets) {
					const registered = standardIds.get(wallet);
					if (registered) {
						api.unregisterProvider(registered.blockchain, registered.id);
						seen.get(registered.blockchain)?.delete(wallet);
						standardIds.delete(wallet);
					}
				}
			}),
		);
	}
	scan();
	return {
		api,
		refresh: scan,
		dispose() {
			if (disposed) return;
			disposed = true;
			cleanup.splice(0).forEach((fn) => fn());
			api.dispose();
		},
	};
}
/** Install the universal API only when window.connect is absent. */
export function installWalletProvider(options: WalletDiscoveryOptions = {}) {
	const target = options.target ?? (window as unknown as ProviderWindow);
	const discovery = discoverWalletProviders({ ...options, target });
	const installed = target.connect == null;
	if (installed) target.connect = discovery.api;
	return {
		...discovery,
		installed,
		dispose() {
			if (installed && target.connect === discovery.api) delete target.connect;
			discovery.dispose();
		},
	};
}
function standardWalletAdapter(
	wallet: Wallet,
	blockchain: 'solana' | 'aptos',
): WalletAdapter {
	const handlers: Partial<
		Record<import('./types.js').WalletMethod, WalletHandler>
	> = {};
	const feature = (
		name: string,
		method: string,
	): ((...args: unknown[]) => unknown) | undefined => {
		const entry = wallet.features[name as `${string}:${string}`] as
			({ version?: string } & Record<string, unknown>) | undefined;
		if (
			!entry ||
			!/^1\./.test(entry.version ?? '') ||
			typeof entry[method] !== 'function'
		)
			return;
		return (entry[method] as (...args: unknown[]) => unknown).bind(entry);
	};
	const connect = feature('standard:connect', 'connect');
	if (connect) handlers.connect = () => connect();
	const disconnect = feature('standard:disconnect', 'disconnect');
	if (disconnect) handlers.disconnect = () => disconnect();
	handlers.getAccounts = () => wallet.accounts;
	for (const [method, name] of [
		['signMessage', 'signMessage'],
		['signTransaction', 'signTransaction'],
		['signAndSendTransaction', 'signAndSendTransaction'],
	] as const) {
		const invoke = feature(`${blockchain}:${name}`, name);
		if (!invoke) continue;
		const signingInput = (
			input: unknown,
			opts: import('./types.js').WalletCallOptions,
		) => {
			const accounts = wallet.accounts.filter(
				(a) =>
					a.chains.some((c) => c.startsWith(`${blockchain}:`)) &&
					a.features.includes(`${blockchain}:${name}`) &&
					(!opts.account || a.address === opts.account),
			);
			if (accounts.length !== 1)
				throw new ProviderNotFoundError(
					'Select one authorized Wallet Standard account.',
				);
			const account = accounts[0];
			const chain = opts.network
				? String(opts.network).startsWith(`${blockchain}:`)
					? String(opts.network)
					: `${blockchain}:${opts.network}`
				: account.chains.filter((c) => c.startsWith(`${blockchain}:`))
							.length === 1
					? account.chains.filter((c) => c.startsWith(`${blockchain}:`))[0]
					: undefined;
			if (chain && !account.chains.includes(chain as `${string}:${string}`))
				throw new ProviderNotFoundError(
					'Account does not support this network.',
				);
			if (!chain && method !== 'signMessage')
				throw new WalletNotConnectedError(
					'Choose a network explicitly for Wallet Standard transactions.',
				);
			if (method !== 'signMessage' && !(input instanceof Uint8Array))
				throw new InvalidTransactionError(
					'Wallet Standard requires serialized transaction bytes.',
				);
			return {
				account,
				chain,
				...(method === 'signMessage'
					? { message: messageBytes(input) }
					: {
							transaction: input,
							...(opts.nativeOptions ? { options: opts.nativeOptions } : {}),
						}),
			};
		};
		handlers[method] = (input, opts) => invoke(signingInput(input, opts));
		if (method === 'signTransaction')
			handlers.signTransactions = (input, opts) => {
				if (!Array.isArray(input) || !input.length)
					throw new InvalidTransactionError(
						'Expected serialized transactions.',
					);
				return invoke(...input.map((tx) => signingInput(tx, opts)));
			};
	}
	return createNativeWalletAdapter(blockchain, wallet, {
		networkMode: 'per-request',
		id: `${blockchain}:standard:${crypto.randomUUID()}`,
		info: createProviderInfo(
			{ name: wallet.name, icon: wallet.icon, rdns: 'wallet.standard' },
			blockchain,
		),
		subscribe: (listener) => {
			const on = feature('standard:events', 'on');
			if (!on) return () => {};
			return on(
				'change',
				(change: { accounts?: unknown; chains?: unknown }) => {
					if (change.accounts) listener('accountsChanged', change.accounts);
					if (change.chains) listener('chainChanged', change.chains);
				},
			) as () => void;
		},
		handlers,
		networks: wallet.chains,
	});
}
