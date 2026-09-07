import { ed448 } from '@noble/curves/ed448.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { ConnectError } from '../protocol.js';
import { chains, defineChain, type ChainDefinition } from '../chains.js';
import { bytesToHex, walletAccountProvider } from './adapter.js';
/** Core Blockchain XCB ICAN address. Network 1: cb; network 3 (Devin): ab. */
export function coreAddress(publicKey: Uint8Array, reference = '1'): string {
	if (publicKey.length !== 57 || !['1', '3'].includes(reference))
		throw new ConnectError('invalidAccount');
	const prefix = reference === '1' ? 'cb' : 'ab',
		body = bytesToHex(sha3_256(publicKey).slice(12));
	const decimal = [...`${body}${prefix}00`]
		.map((c) => parseInt(c, 16).toString())
		.join('');
	return `${prefix}${(98n - (BigInt(decimal) % 97n)).toString().padStart(2, '0')}${body}`;
}
export function verifyCoreSignature(
	message: Uint8Array,
	signature: Uint8Array,
	publicKey: Uint8Array,
): boolean {
	try {
		return (
			publicKey.length === 57 &&
			signature.length === 114 &&
			ed448.verify(signature, message, publicKey)
		);
	} catch {
		return false;
	}
}
export interface CoreWalletAccount {
	readonly address: string;
	readonly publicKey: Uint8Array;
	readonly reference: string;
}
/** Connect-defined bridge for future Core wallets, not an assumed injected RPC API.
 * signConnect must use pure Ed448, empty context, with no personal-message prefix. */
export interface CoreWalletBridge {
	getAccounts(): Promise<readonly CoreWalletAccount[]>;
	signConnect(input: {
		account: CoreWalletAccount;
		message: Uint8Array;
		algorithm: 'Ed448';
	}): Promise<Uint8Array>;
}
export function coreAccountProvider(
	wallet: CoreWalletBridge,
	chain: ChainDefinition = chains.core,
) {
	chain = Object.freeze({ ...chain });
	if (
		chain.namespace !== 'core' ||
		chain.profile !== 'xcb-ed448' ||
		chain.alg !== -53 ||
		!['1', '3'].includes(chain.reference)
	)
		throw new ConnectError('invalidConfiguration');
	async function current() {
		const list = (await wallet.getAccounts()).filter(
			(a) => a.reference === chain.reference,
		);
		return list.map((a) => {
			const key = a.publicKey.slice();
			if (coreAddress(key, a.reference) !== a.address)
				throw new ConnectError('invalidAccount');
			return { address: a.address, reference: a.reference, publicKey: key };
		});
	}
	return walletAccountProvider({
		chain,
		getAccounts: async () => (await current()).map((a) => a.address),
		async sign(address, message) {
			const account = (await current()).find((a) => a.address === address);
			if (!account) throw new ConnectError('accountChanged');
			const expected = account.publicKey.slice();
			const signature = await wallet.signConnect({
				account: { ...account, publicKey: expected.slice() },
				message: message.slice(),
				algorithm: 'Ed448',
			});
			if (!verifyCoreSignature(message, signature, expected))
				throw new ConnectError('invalidProof');
			return { signature, publicKey: expected };
		},
	});
}

export function coreChain(
	network: 'mainnet' | 'devin' = 'mainnet',
): Readonly<ChainDefinition> {
	if (!['mainnet', 'devin'].includes(network))
		throw new ConnectError('invalidConfiguration');
	return defineChain({
		...chains.core,
		name: network === 'mainnet' ? 'Core Blockchain' : 'Core Blockchain Devin',
		reference: network === 'mainnet' ? '1' : '3',
	});
}
export function validateCoreAddress(address: string, reference = '1'): boolean {
	if (
		!['1', '3'].includes(reference) ||
		!/^(cb|ab)[0-9]{2}[a-f0-9]{40}$(?![\s\S])/.test(address) ||
		address.slice(0, 2) !== (reference === '1' ? 'cb' : 'ab')
	)
		return false;
	const decimal = [...`${address.slice(4)}${address.slice(0, 4)}`]
		.map((c) => parseInt(c, 16).toString())
		.join('');
	return BigInt(decimal) % 97n === 1n;
}
