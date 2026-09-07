import {
	accountSchema,
	requirementSchema,
	type Requirement,
	type Selection,
} from './protocol.js';
import type { WalletAccount } from './wallet.js';

/** The callback signs the unchanged canonical UTF-8 bytes using this wallet method.
 * Encodings describe the proof fields, not the input to the wallet method. */
export interface ChainDefinition extends Requirement {
	readonly name: string;
	readonly signingMethod: string;
	readonly signatureEncoding: string;
	readonly publicKeyEncoding?: string;
}
export function defineChain(chain: ChainDefinition): Readonly<ChainDefinition> {
	requirementSchema.parse({
		namespace: chain.namespace,
		reference: chain.reference,
		profile: chain.profile,
		alg: chain.alg,
	});
	return Object.freeze({ ...chain });
}
/** Any EVM network using EOA personal_sign can reuse the SIWE verifier. */
export function evmChain(
	name: string,
	chainId: number | bigint,
): Readonly<ChainDefinition> {
	if (typeof chainId === 'number' && !Number.isSafeInteger(chainId))
		throw new Error('Invalid EVM chain ID');
	if (!/^[1-9][0-9]{0,14}$/.test(String(chainId)))
		throw new Error('Invalid EVM chain ID');
	return defineChain({
		name,
		namespace: 'eip155',
		reference: String(chainId),
		profile: 'ethereum-siwe',
		alg: null,
		signingMethod: 'personal_sign',
		signatureEncoding: 'hex0x',
	});
}
export const chains = Object.freeze({
	core: defineChain({
		name: 'Core Blockchain',
		namespace: 'core',
		reference: '1',
		profile: 'xcb-ed448',
		alg: -53,
		signingMethod: 'ed448',
		signatureEncoding: 'hex',
		publicKeyEncoding: 'hex',
	}),
	ethereum: defineChain({
		name: 'Ethereum',
		namespace: 'eip155',
		reference: '1',
		profile: 'ethereum-siwe',
		alg: null,
		signingMethod: 'personal_sign',
		signatureEncoding: 'hex0x',
	}),
	polygon: defineChain({
		name: 'Polygon',
		namespace: 'eip155',
		reference: '137',
		profile: 'ethereum-siwe',
		alg: null,
		signingMethod: 'personal_sign',
		signatureEncoding: 'hex0x',
	}),
	base: defineChain({
		name: 'Base',
		namespace: 'eip155',
		reference: '8453',
		profile: 'ethereum-siwe',
		alg: null,
		signingMethod: 'personal_sign',
		signatureEncoding: 'hex0x',
	}),
	bnb: defineChain({
		name: 'BNB Smart Chain',
		namespace: 'eip155',
		reference: '56',
		profile: 'ethereum-siwe',
		alg: null,
		signingMethod: 'personal_sign',
		signatureEncoding: 'hex0x',
	}),
	bitcoin: defineChain({
		name: 'Bitcoin',
		namespace: 'bip122',
		reference: '000000000019d6689c085ae165831e93',
		profile: 'bitcoin-bip322-p2wpkh',
		alg: null,
		signingMethod: 'bip322-simple',
		signatureEncoding: 'base64',
	}),
	solana: defineChain({
		name: 'Solana',
		namespace: 'solana',
		reference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
		profile: 'solana-ed25519',
		alg: -19,
		signingMethod: 'signMessage',
		signatureEncoding: 'hex',
	}),
	tron: defineChain({
		name: 'TRON',
		namespace: 'tron',
		reference: '728126428',
		profile: 'tron-signmessage-v2',
		alg: null,
		signingMethod: 'signMessageV2',
		signatureEncoding: 'hex0x',
	}),
	monero: defineChain({
		name: 'Monero',
		namespace: 'monero',
		reference: '418015bb9ae982a1975da7d79277c270',
		profile: 'monero-spend-v2',
		alg: null,
		signingMethod: 'sign-spend',
		signatureEncoding: 'sigv2',
	}),
	stellar: defineChain({
		name: 'Stellar',
		namespace: 'stellar',
		reference: 'pubnet',
		profile: 'stellar-sep53',
		alg: -19,
		signingMethod: 'sep53',
		signatureEncoding: 'hex',
	}),
	litecoin: defineChain({
		name: 'Litecoin',
		namespace: 'bip122',
		reference: '12a765e31ffd4059bada1e25190f6e98',
		profile: 'litecoin-signmessage',
		alg: null,
		signingMethod: 'signmessage',
		signatureEncoding: 'base64',
	}),
	ripple: defineChain({
		name: 'XRP Ledger',
		namespace: 'xrpl',
		reference: '0',
		profile: 'xrpl-secp256k1',
		alg: null,
		signingMethod: 'sign',
		signatureEncoding: 'hex',
		publicKeyEncoding: 'hex',
	}),
	zcash: defineChain({
		name: 'Zcash',
		namespace: 'bip122',
		reference: '00040fe8ec8471911baa1db1266ea15d',
		profile: 'zcash-signmessage',
		alg: null,
		signingMethod: 'signmessage',
		signatureEncoding: 'base64',
	}),
	cardano: defineChain({
		name: 'Cardano',
		namespace: 'cip34',
		reference: '1-764824073',
		profile: 'cardano-cip8',
		alg: -19,
		signingMethod: 'signData',
		signatureEncoding: 'cose-hex',
		publicKeyEncoding: 'cose-hex',
	}),
	bitcoinLegacy: defineChain({
		name: 'Bitcoin (legacy P2PKH)',
		namespace: 'bip122',
		reference: '000000000019d6689c085ae165831e93',
		profile: 'bitcoin-signmessage',
		alg: null,
		signingMethod: 'signmessage',
		signatureEncoding: 'base64',
	}),
	rippleEd25519: defineChain({
		name: 'XRP Ledger (Ed25519)',
		namespace: 'xrpl',
		reference: '0',
		profile: 'xrpl-ed25519',
		alg: -19,
		signingMethod: 'sign',
		signatureEncoding: 'hex',
		publicKeyEncoding: 'hex',
	}),
});
/** Explicit opt-in to every built-in mainnet and supported alternate proof scheme. */
export const allChains: readonly ChainDefinition[] = Object.freeze(
	Object.values(chains),
);
export function requirementsFor(
	selected: readonly ChainDefinition[],
): Requirement[] {
	const result = new Map<string, Requirement>();
	for (const c of selected) {
		const r = requirementSchema.parse({
			namespace: c.namespace,
			reference: c.reference,
			profile: c.profile,
			alg: c.alg,
		});
		result.set(JSON.stringify(r), r);
	}
	return [...result.values()];
}
export function accountFor(chain: ChainDefinition, address: string): Selection {
	const [r] = requirementsFor([chain]);
	return Object.freeze({
		account: Object.freeze(
			accountSchema.parse({
				namespace: r.namespace,
				reference: r.reference,
				address,
			}),
		),
		profile: r.profile,
		alg: r.alg,
	});
}
export function walletAccount(
	chain: ChainDefinition,
	address: string,
	sign: WalletAccount['sign'],
): WalletAccount {
	return Object.freeze({ ...accountFor(chain, address), sign });
}
