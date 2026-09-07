import { ConnectError } from '../protocol.js';
import { chains, type ChainDefinition } from '../chains.js';
import { walletAccountProvider, type WalletDriver } from './adapter.js';
/** Native Bitcoin-like wallet bridges must use the exact configured message method. */
export function bitcoinAccountProvider(
	driver: Omit<WalletDriver, 'chain'>,
	chain: ChainDefinition = chains.bitcoin,
) {
	if (
		chain.namespace !== 'bip122' ||
		![
			'bitcoin-bip322-p2wpkh',
			'bitcoin-signmessage',
			'litecoin-signmessage',
			'zcash-signmessage',
		].includes(chain.profile)
	)
		throw new ConnectError('invalidConfiguration');
	return walletAccountProvider({
		...driver,
		chain,
		getAccounts: async () => {
			const addresses = await driver.getAccounts();
			return addresses.filter((a) =>
				chain.profile === 'bitcoin-bip322-p2wpkh'
					? /^bc1q[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(a)
					: chain.profile === 'bitcoin-signmessage'
						? a.startsWith('1')
						: chain.profile === 'litecoin-signmessage'
							? a.startsWith('L')
							: a.startsWith('t1'),
			);
		},
		sign: driver.sign.bind(driver),
	});
}
/** Canonical bytes go to a TIP-191 signMessageV2 implementation (TronWeb/native). */
export function tronAccountProvider(driver: Omit<WalletDriver, 'chain'>) {
	return walletAccountProvider({
		...driver,
		chain: chains.tron,
		getAccounts: driver.getAccounts.bind(driver),
		sign: driver.sign.bind(driver),
	});
}
/** SEP-53 signing, not raw Ed25519: the host applies its standard message wrapper. */
export function stellarAccountProvider(driver: Omit<WalletDriver, 'chain'>) {
	return walletAccountProvider({
		...driver,
		chain: chains.stellar,
		getAccounts: driver.getAccounts.bind(driver),
		sign: driver.sign.bind(driver),
	});
}
/** Modern Monero spend-key SigV2; never view-key signatures. */
export function moneroAccountProvider(driver: Omit<WalletDriver, 'chain'>) {
	return walletAccountProvider({
		...driver,
		chain: chains.monero,
		getAccounts: driver.getAccounts.bind(driver),
		sign: driver.sign.bind(driver),
	});
}
export function rippleAccountProvider(
	driver: Omit<WalletDriver, 'chain'>,
	keyType: 'secp256k1' | 'ed25519' = 'secp256k1',
) {
	if (!['secp256k1', 'ed25519'].includes(keyType))
		throw new ConnectError('invalidConfiguration');
	return walletAccountProvider({
		...driver,
		chain: keyType === 'ed25519' ? chains.rippleEd25519 : chains.ripple,
		getAccounts: driver.getAccounts.bind(driver),
		sign: driver.sign.bind(driver),
	});
}

export interface TronLinkProvider {
	request(input: {
		method: string;
		params?: readonly unknown[];
	}): Promise<unknown>;
	readonly tronWeb:
		| false
		| {
				readonly defaultAddress: { readonly base58: string | false };
				readonly trx: { signMessageV2(message: Uint8Array): Promise<string> };
		  };
}
/** Modern TronLink-style authorized provider. Authorization is a separate UI action. */
export function tronLinkAccountProvider(provider: TronLinkProvider) {
	return tronAccountProvider({
		async getAccounts() {
			const address =
				provider.tronWeb && provider.tronWeb.defaultAddress.base58;
			if (!address) return [];
			const chainId = await provider.request({ method: 'eth_chainId' });
			if (
				typeof chainId !== 'string' ||
				!/^0x[0-9a-fA-F]+$/.test(chainId) ||
				BigInt(chainId).toString() !== chains.tron.reference
			)
				throw new ConnectError('networkMismatch');
			return [address];
		},
		async sign(_address, message) {
			if (!provider.tronWeb) throw new ConnectError('accountChanged');
			return { signature: await provider.tronWeb.trx.signMessageV2(message) };
		},
	});
}
