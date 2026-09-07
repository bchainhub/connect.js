import { getWallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import { ConnectError } from '../protocol.js';
import type { Eip1193Provider } from './ethereum.js';
export { getWallets as getStandardWallets } from '@wallet-standard/app';
export type { Wallet as StandardWallet } from '@wallet-standard/base';
/** Includes all registered wallets exposing the required feature, regardless of brand. */
export function getSolanaWallets(): readonly Wallet[] {
	return getWallets()
		.get()
		.filter(
			(w) =>
				w.chains.includes('solana:mainnet') &&
				'solana:signMessage' in w.features,
		);
}
export interface EthereumWalletAnnouncement {
	readonly info: {
		readonly uuid: string;
		readonly name: string;
		readonly icon: string;
		readonly rdns: string;
	};
	readonly provider: Eip1193Provider;
}
/** EIP-6963 metadata is untrusted display data, not authenticated wallet identity.
 * Discovery does not request accounts. Dispose when the wallet picker is closed. */
export function discoverEthereumWallets(
	target: EventTarget = window,
	onChange?: () => void,
) {
	const wallets = new Map<string, EthereumWalletAnnouncement>();
	let disposed = false;
	const announce = (event: Event) => {
		try {
			const data = (event as CustomEvent<EthereumWalletAnnouncement>).detail;
			if (!data?.info || typeof data.provider?.request !== 'function') return;
			const { uuid, name, icon, rdns } = data.info;
			if (
				typeof uuid !== 'string' ||
				!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid) ||
				typeof name !== 'string' ||
				!name ||
				name.length > 256 ||
				typeof icon !== 'string' ||
				icon.length > 262144 ||
				typeof rdns !== 'string' ||
				rdns.length > 253 ||
				wallets.has(uuid) ||
				[...wallets.values()].some((w) => w.provider === data.provider)
			)
				return;
			wallets.set(
				uuid,
				Object.freeze({
					info: Object.freeze({ uuid, name, icon, rdns }),
					provider: data.provider,
				}),
			);
			try {
				onChange?.();
			} catch {
				/* Isolate UI observers. */
			}
		} catch {
			/* Ignore malformed announcements from other page scripts. */
		}
	};
	target.addEventListener('eip6963:announceProvider', announce);
	target.dispatchEvent(new Event('eip6963:requestProvider'));
	return Object.freeze({
		get: () => Object.freeze([...wallets.values()]),
		refresh() {
			if (disposed) throw new ConnectError('invalidState');
			target.dispatchEvent(new Event('eip6963:requestProvider'));
		},
		dispose() {
			disposed = true;
			target.removeEventListener('eip6963:announceProvider', announce);
			wallets.clear();
		},
	});
}
