import { bech32 } from '@scure/base';
import { ConnectError } from '../protocol.js';
import { chains } from '../chains.js';
import { hexToBytes, bytesToHex, walletAccountProvider } from './adapter.js';
/** The authorized API returned by a CIP-30 wallet's enable() call. */
export interface CardanoWalletApi {
	getNetworkId(): Promise<number>;
	getUsedAddresses(): Promise<readonly string[]>;
	getUnusedAddresses(): Promise<readonly string[]>;
	getRewardAddresses?(): Promise<readonly string[]>;
	signData(
		addressHex: string,
		payloadHex: string,
	): Promise<{ signature: string; key: string }>;
}
export function cardanoAccountProvider(wallet: CardanoWalletApi) {
	async function addresses() {
		if ((await wallet.getNetworkId()) !== 1)
			throw new ConnectError('networkMismatch');
		const inputs = [
			...(await wallet.getUsedAddresses()),
			...(await wallet.getUnusedAddresses()),
			...((await wallet.getRewardAddresses?.()) ?? []),
		];
		const result = new Map<string, string>();
		for (const hex of inputs) {
			const raw = hexToBytes(hex),
				kind = raw[0] >> 4;
			if ((raw[0] & 15) !== 1) throw new ConnectError('networkMismatch');
			if (
				![0, 2, 6, 14].includes(kind) ||
				raw.length !== ([0, 2].includes(kind) ? 57 : 29)
			)
				continue;
			result.set(
				bech32.encode(kind === 14 ? 'stake' : 'addr', bech32.toWords(raw), 128),
				hex.toLowerCase(),
			);
		}
		return result;
	}
	return walletAccountProvider({
		chain: chains.cardano,
		async getAccounts() {
			return [...(await addresses()).keys()];
		},
		async sign(address, message) {
			const raw = (await addresses()).get(address);
			if (!raw) throw new ConnectError('accountChanged');
			const result = await wallet.signData(raw, bytesToHex(message));
			return { signature: result.signature, publicKey: result.key };
		},
	});
}
