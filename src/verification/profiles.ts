import { additionalProfiles } from './multichain.js';
import {
	coreAddress as xcbAddress,
	validateCoreAddress,
	verifyCoreSignature,
} from '../wallet/core.js';
export { coreAddress as xcbAddress } from '../wallet/core.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getAddress, verifyMessage, type Hex } from 'viem';
import { Verifier } from 'bip322-js';
import {
	ConnectError,
	canonicalMessage,
	type Account,
	type Challenge,
	type Proof,
} from '../protocol.js';

export interface SigningProfile {
	readonly id: string;
	readonly namespace: string;
	readonly alg: number | null;
	validateAccount(account: Account): boolean;
	verify(challenge: Challenge, proof: Proof): Promise<Account>;
}
export function hexBytes(
	value: string | undefined,
	length: number,
): Uint8Array {
	if (
		!value ||
		!new RegExp(`^[a-f0-9]{${length * 2}}$(?![\\s\\S])`).test(value)
	)
		throw new ConnectError('malformedProof');
	return Uint8Array.from(Buffer.from(value, 'hex'));
}
function xcbValid(a: Account): boolean {
	return a.namespace === 'core' && validateCoreAddress(a.address, a.reference);
}
export const xcbProfile: SigningProfile = {
	id: 'xcb-ed448',
	namespace: 'core',
	alg: -53,
	validateAccount: xcbValid,
	async verify(c, p) {
		const key = hexBytes(p.publicKey, 57),
			sig = hexBytes(p.signature, 114);
		if (
			xcbAddress(key, p.account.reference) !== p.account.address ||
			!verifyCoreSignature(
				new TextEncoder().encode(canonicalMessage(c, p)),
				sig,
				key,
			)
		)
			throw new ConnectError('invalidProof');
		return p.account;
	},
};
export const ed25519Profile: SigningProfile = {
	id: 'raw-ed25519',
	namespace: 'raw',
	alg: -19,
	validateAccount: (a) =>
		a.namespace === 'raw' &&
		a.reference === 'ed25519' &&
		/^[a-f0-9]{64}(?![\s\S])/.test(a.address),
	async verify(c, p) {
		const key = hexBytes(p.account.address, 32);
		if (
			(p.publicKey !== undefined && p.publicKey !== p.account.address) ||
			!ed25519.verify(
				hexBytes(p.signature, 64),
				new TextEncoder().encode(canonicalMessage(c, p)),
				key,
				{ zip215: false },
			)
		)
			throw new ConnectError('invalidProof');
		return p.account;
	},
};
export const ethereumProfile: SigningProfile = {
	id: 'ethereum-siwe',
	namespace: 'eip155',
	alg: null,
	validateAccount(a) {
		try {
			return (
				a.namespace === 'eip155' &&
				/^[1-9][0-9]{0,14}(?![\s\S])/.test(a.reference) &&
				getAddress(a.address) === a.address
			);
		} catch {
			return false;
		}
	},
	async verify(c, p) {
		if (
			p.publicKey !== undefined ||
			!/^0x[0-9a-f]{130}(?![\s\S])/.test(p.signature) ||
			!(await verifyMessage({
				address: p.account.address as Hex,
				message: canonicalMessage(c, p),
				signature: p.signature as Hex,
			}))
		)
			throw new ConnectError('invalidProof');
		return p.account;
	},
};
/** Only native SegWit v0 P2WPKH; no legacy/recovery fallback or script guessing. */
export const bitcoinProfile: SigningProfile = {
	id: 'bitcoin-bip322-p2wpkh',
	namespace: 'bip122',
	alg: null,
	validateAccount: (a) =>
		a.namespace === 'bip122' &&
		a.reference === '000000000019d6689c085ae165831e93' &&
		/^bc1q[023456789acdefghjklmnpqrstuvwxyz]{38}(?![\s\S])/.test(a.address),
	async verify(c, p) {
		if (
			p.publicKey !== undefined ||
			!/^[A-Za-z0-9+/]+={0,2}(?![\s\S])/.test(p.signature)
		)
			throw new ConnectError('invalidProof');
		const bytes = Buffer.from(p.signature, 'base64');
		// Two stack elements, a DER signature with SIGHASH_ALL and compressed public key.
		const n = bytes[1];
		if (
			bytes.toString('base64') !== p.signature ||
			bytes[0] !== 2 ||
			n < 9 ||
			n > 73 ||
			bytes[2] !== 0x30 ||
			bytes[1 + n] !== 1 ||
			bytes[2 + n] !== 33 ||
			![2, 3].includes(bytes[3 + n]) ||
			bytes.length !== n + 36 ||
			!Verifier.verifySignature(
				p.account.address,
				canonicalMessage(c, p),
				p.signature,
			)
		)
			throw new ConnectError('invalidProof');
		return p.account;
	},
};
export class ProfileRegistry {
	private readonly profiles = new Map<string, SigningProfile>();
	constructor(
		profiles: readonly SigningProfile[] = [
			xcbProfile,
			ed25519Profile,
			ethereumProfile,
			bitcoinProfile,
			...additionalProfiles,
		],
	) {
		for (const p of profiles) {
			if (this.profiles.has(p.id)) throw new ConnectError('duplicateProfile');
			this.profiles.set(p.id, p);
		}
	}
	with(...profiles: readonly SigningProfile[]): ProfileRegistry {
		return new ProfileRegistry([...this.profiles.values(), ...profiles]);
	}
	get(id: string) {
		const p = this.profiles.get(id);
		if (!p) throw new ConnectError('unsupportedProfile');
		return p;
	}
}

/** Extend built-ins without reconstructing the registry. */
export const builtInProfiles: readonly SigningProfile[] = Object.freeze([
	xcbProfile,
	ed25519Profile,
	ethereumProfile,
	bitcoinProfile,
	...additionalProfiles,
]);
