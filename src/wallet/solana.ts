import { base58 } from '@scure/base';
import type { Wallet } from '@wallet-standard/base';
import type { StandardConnectFeature } from '@wallet-standard/features';
import type { SolanaSignMessageFeature } from '@solana/wallet-standard-features';
import { ConnectError } from '../protocol.js';
import { chains } from '../chains.js';
import { equalBytes, walletAccountProvider } from './adapter.js';
export interface SolanaPublicKey {
	toBase58(): string;
}
/** Phantom/Solflare-style injected Solana provider; already authorized by the user. */
export interface SolanaWalletProvider {
	readonly publicKey: SolanaPublicKey | null;
	signMessage(
		message: Uint8Array,
		display?: 'utf8',
	): Promise<{ signature: Uint8Array; publicKey?: SolanaPublicKey }>;
}
export function solanaAccountProvider(provider: SolanaWalletProvider) {
	return walletAccountProvider({
		chain: chains.solana,
		async getAccounts() {
			const address = provider.publicKey?.toBase58();
			if (!address) return [];
			if (base58.decode(address).length !== 32)
				throw new ConnectError('invalidAccount');
			return [address];
		},
		async sign(address, message) {
			const result = await provider.signMessage(message, 'utf8');
			if (
				!(result.signature instanceof Uint8Array) ||
				result.signature.length !== 64 ||
				(result.publicKey && result.publicKey.toBase58() !== address)
			)
				throw new ConnectError('malformedProof');
			return { signature: result.signature };
		},
	});
}
/** Explicit authorization action; never called by discovery or getAccounts. */
export async function requestStandardAccounts(wallet: Wallet) {
	const feature = wallet.features['standard:connect'] as
		StandardConnectFeature['standard:connect'] | undefined;
	if (feature?.version !== '1.0.0' || typeof feature.connect !== 'function')
		throw new ConnectError('unsupportedWallet');
	return (await feature.connect()).accounts;
}
export function solanaStandardAccountProvider(wallet: Wallet) {
	const feature = wallet.features['solana:signMessage'] as
		SolanaSignMessageFeature['solana:signMessage'] | undefined;
	if (
		!feature ||
		!['1.0.0', '1.1.0'].includes(feature.version) ||
		typeof feature.signMessage !== 'function'
	)
		throw new ConnectError('unsupportedWallet');
	const signMessage = feature.signMessage.bind(feature);
	function accounts() {
		return wallet.accounts
			.filter(
				(a) =>
					a.chains.includes('solana:mainnet') &&
					a.features.includes('solana:signMessage'),
			)
			.map((a) => {
				if (
					a.publicKey.length !== 32 ||
					base58.encode(Uint8Array.from(a.publicKey)) !== a.address
				)
					throw new ConnectError('invalidAccount');
				return a;
			});
	}
	return walletAccountProvider({
		chain: chains.solana,
		async getAccounts() {
			return accounts().map((a) => a.address);
		},
		async sign(address, message) {
			const account = accounts().find((a) => a.address === address);
			if (!account) throw new ConnectError('accountChanged');
			const output = await signMessage({ account, message: message.slice() });
			if (
				output.length !== 1 ||
				!(output[0].signature instanceof Uint8Array) ||
				output[0].signature.length !== 64 ||
				!equalBytes(output[0].signedMessage, message) ||
				(output[0].signatureType !== undefined &&
					output[0].signatureType !== 'ed25519')
			)
				throw new ConnectError('malformedProof');
			return { signature: output[0].signature };
		},
	});
}
