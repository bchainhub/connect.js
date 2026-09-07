import { base64 } from '@scure/base';
import { ConnectError, proofSchema, type Proof } from '../protocol.js';
import { defineChain, walletAccount, type ChainDefinition } from '../chains.js';
import type { AccountProvider } from '../wallet.js';
export type WalletSignature = {
	signature: string | Uint8Array;
	publicKey?: string | Uint8Array;
};
/** A bridge for wallets with native, hardware, RPC or SDK-specific signing APIs.
 * getAccounts must be passive. sign is called only after Connect approval. */
export interface WalletDriver {
	chain: ChainDefinition;
	getAccounts(): Promise<readonly string[]>;
	sign(address: string, canonicalBytes: Uint8Array): Promise<WalletSignature>;
}
export function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function hexToBytes(hex: string): Uint8Array {
	if (!/^(?:[0-9a-fA-F]{2})+$(?![\s\S])/.test(hex))
		throw new ConnectError('malformedProof');
	return Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
}
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}
function encoded(value: string | Uint8Array, encoding: string): string {
	if (value instanceof Uint8Array) {
		if (encoding === 'base64') return base64.encode(value);
		if (['hex', 'cose-hex', 'hex0x'].includes(encoding))
			return (encoding === 'hex0x' ? '0x' : '') + bytesToHex(value);
		throw new ConnectError('malformedProof');
	}
	if (typeof value !== 'string') throw new ConnectError('malformedProof');
	if (['hex', 'cose-hex'].includes(encoding)) {
		hexToBytes(value);
		return value.toLowerCase();
	}
	if (encoding === 'hex0x') {
		if (!value.startsWith('0x')) throw new ConnectError('malformedProof');
		hexToBytes(value.slice(2));
		return value.toLowerCase();
	}
	if (encoding === 'base64' && base64.encode(base64.decode(value)) !== value)
		throw new ConnectError('malformedProof');
	return value;
}
export function walletAccountProvider(driver: WalletDriver): AccountProvider {
	const chain = defineChain(driver.chain),
		getAccounts = driver.getAccounts.bind(driver),
		sign = driver.sign.bind(driver);
	async function current() {
		const addresses = await getAccounts();
		if (
			!Array.isArray(addresses) ||
			!addresses.every((a) => typeof a === 'string')
		)
			throw new ConnectError('invalidAccount');
		return addresses;
	}
	return {
		async getAccounts() {
			const addresses = await current();
			return [...new Set(addresses)].map((address) =>
				walletAccount(chain, address, async (bytes) => {
					if (!(await current()).includes(address))
						throw new ConnectError('accountChanged');
					const result = await sign(address, bytes.slice());
					if (!(await current()).includes(address))
						throw new ConnectError('accountChanged');
					const proof: Pick<Proof, 'signature' | 'publicKey'> = {
						signature: encoded(result.signature, chain.signatureEncoding),
					};
					if (result.publicKey !== undefined) {
						if (!chain.publicKeyEncoding)
							throw new ConnectError('malformedProof');
						proof.publicKey = encoded(
							result.publicKey,
							chain.publicKeyEncoding,
						);
					}
					proofSchema.shape.signature.parse(proof.signature);
					proofSchema.shape.publicKey.parse(proof.publicKey);
					return proof;
				}),
			);
		},
	};
}
/** Compose already-selected wallets; no discovery or permission prompt is implicit. */
export function combineWalletProviders(
	...providers: readonly AccountProvider[]
): AccountProvider {
	return {
		async getAccounts() {
			return (await Promise.all(providers.map((p) => p.getAccounts()))).flat();
		},
	};
}
