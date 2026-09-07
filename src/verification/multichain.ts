import { chains } from '../chains.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { base58, base58check, base58xrp, bech32 } from '@scure/base';
import { StrKey } from '@stellar/stellar-sdk';
import * as ripple from 'ripple-keypairs';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { Trx, TronWeb } from 'tronweb';
import { decode, encode } from 'cborg';
import {
	ConnectError,
	canonicalMessage,
	type Account,
	type Challenge,
	type Proof,
} from '../protocol.js';
import type { SigningProfile } from './profiles.js';

const utf8 = (s: string) => new TextEncoder().encode(s);
const message = (c: Challenge, p: Proof) => utf8(canonicalMessage(c, p));
const equal = (a: Uint8Array | undefined, b: Uint8Array) =>
	a !== undefined && Buffer.from(a).equals(Buffer.from(b));
function hex(s: string | undefined, length?: number): Uint8Array {
	if (
		!s ||
		!/^(?:[0-9a-f]{2})+$(?![\s\S])/.test(s) ||
		(length !== undefined && s.length !== length * 2)
	)
		throw new ConnectError('malformedProof');
	return Uint8Array.from(Buffer.from(s, 'hex'));
}
/** Wrap a verifier to consistently reject malformed inputs, including library exceptions. */
export function defineSigningProfile(config: {
	id: string;
	namespace: string;
	alg: number | null;
	validateAccount: (account: Account) => boolean;
	verify: (challenge: Challenge, proof: Proof) => boolean | Promise<boolean>;
}): SigningProfile {
	config = { ...config };
	const validateAccount = (a: Account) => {
		try {
			return (
				a.namespace === config.namespace && config.validateAccount(a) === true
			);
		} catch {
			return false;
		}
	};
	return Object.freeze({
		id: config.id,
		namespace: config.namespace,
		alg: config.alg,
		validateAccount,
		async verify(c: Challenge, p: Proof) {
			try {
				if (
					p.profile !== config.id ||
					p.alg !== config.alg ||
					!validateAccount(p.account) ||
					(await config.verify(c, p)) !== true
				)
					throw new ConnectError('invalidProof');
				return p.account;
			} catch {
				throw new ConnectError('invalidProof');
			}
		},
	});
}
export const solanaProfile = defineSigningProfile({
	id: 'solana-ed25519',
	namespace: 'solana',
	alg: -19,
	validateAccount: (a) =>
		a.reference === chains.solana.reference &&
		base58.decode(a.address).length === 32 &&
		base58.encode(base58.decode(a.address)) === a.address,
	verify: (c, p) =>
		p.publicKey === undefined &&
		ed25519.verify(
			hex(p.signature, 64),
			message(c, p),
			base58.decode(p.account.address),
			{ zip215: false },
		),
});
/** SEP-53 digest for an existing raw Ed25519 signing API. */
export function stellarMessageHash(bytes: Uint8Array): Uint8Array {
	return sha256(
		Buffer.concat([Buffer.from('Stellar Signed Message:\n'), bytes]),
	);
}
export const stellarProfile = defineSigningProfile({
	id: 'stellar-sep53',
	namespace: 'stellar',
	alg: -19,
	validateAccount: (a) =>
		a.reference === 'pubnet' &&
		StrKey.isValidEd25519PublicKey(a.address) &&
		StrKey.encodeEd25519PublicKey(StrKey.decodeEd25519PublicKey(a.address)) ===
			a.address,
	verify: (c, p) =>
		p.publicKey === undefined &&
		ed25519.verify(
			hex(p.signature, 64),
			stellarMessageHash(message(c, p)),
			StrKey.decodeEd25519PublicKey(p.account.address),
			{ zip215: false },
		),
});
export const tronProfile = defineSigningProfile({
	id: 'tron-signmessage-v2',
	namespace: 'tron',
	alg: null,
	validateAccount: (a) =>
		a.reference === chains.tron.reference &&
		/^T[1-9A-HJ-NP-Za-km-z]{33}$(?![\s\S])/.test(a.address) &&
		TronWeb.isAddress(a.address),
	verify: (c, p) =>
		p.publicKey === undefined &&
		/^0x[0-9a-f]{130}$(?![\s\S])/.test(p.signature) &&
		Trx.verifyMessageV2(message(c, p), p.signature) === p.account.address,
});
function validXrp(address: string): boolean {
	const raw = base58xrp.decode(address);
	return (
		raw.length === 25 &&
		raw[0] === 0 &&
		equal(raw.slice(-4), sha256(sha256(raw.slice(0, -4))).slice(0, 4)) &&
		base58xrp.encode(raw) === address
	);
}
function xrpProfile(ed: boolean): SigningProfile {
	return defineSigningProfile({
		id: ed ? 'xrpl-ed25519' : 'xrpl-secp256k1',
		namespace: 'xrpl',
		alg: ed ? -19 : null,
		validateAccount: (a) => a.reference === '0' && validXrp(a.address),
		verify(c, p) {
			const key = hex(p.publicKey, 33);
			if (ed ? key[0] !== 0xed : ![2, 3].includes(key[0])) return false;
			hex(p.signature, ed ? 64 : undefined);
			if (!ed && (p.signature.length < 16 || p.signature.length > 144))
				return false;
			return (
				ripple.deriveAddress(p.publicKey!) === p.account.address &&
				ripple.verify(
					Buffer.from(message(c, p)).toString('hex'),
					p.signature,
					p.publicKey!,
				)
			);
		},
	});
}
export const rippleProfile = xrpProfile(false);
export const rippleEd25519Profile = xrpProfile(true);
const check = base58check(sha256);
/** Standard recoverable signmessage for P2PKH. Prefix and address version are pinned.
 * CompactSize-prefixed message hashing and noble secp256k1 recovery support
 * both one-byte and two-byte address versions. */
function compactSize(n: number): Buffer {
	if (n < 253) return Buffer.from([n]);
	if (n > 65535) throw new ConnectError('malformedProof');
	const bytes = Buffer.alloc(3);
	bytes[0] = 253;
	bytes.writeUInt16LE(n, 1);
	return bytes;
}
export function utxoMessageProfile(config: {
	id: string;
	reference: string;
	messagePrefix: string;
	addressVersion: readonly number[];
}): SigningProfile {
	function payload(address: string) {
		const raw = check.decode(address),
			prefix = Uint8Array.from(config.addressVersion);
		if (
			raw.length !== prefix.length + 20 ||
			!equal(raw.slice(0, prefix.length), prefix) ||
			check.encode(raw) !== address
		)
			throw new ConnectError('invalidAccount');
		return raw.slice(prefix.length);
	}
	return defineSigningProfile({
		id: config.id,
		namespace: 'bip122',
		alg: null,
		validateAccount: (a) =>
			a.reference === config.reference && payload(a.address).length === 20,
		verify(c, p) {
			if (p.publicKey !== undefined) return false;
			const sig = Buffer.from(p.signature, 'base64');
			if (
				sig.length !== 65 ||
				sig.toString('base64') !== p.signature ||
				sig[0] < 27 ||
				sig[0] > 34
			)
				return false;
			const text = Buffer.from(canonicalMessage(c, p));
			const prefix = Buffer.from(config.messagePrefix);
			const digest = sha256(
				sha256(
					Buffer.concat([
						compactSize(prefix.length),
						prefix,
						compactSize(text.length),
						text,
					]),
				),
			);
			const flag = sig[0] - 27;
			const recovered = secp256k1.recoverPublicKey(
				Uint8Array.from([flag & 3, ...sig.subarray(1)]),
				digest,
				{ prehash: false },
			);
			const publicKey = secp256k1.Point.fromBytes(recovered).toBytes(
				(flag & 4) !== 0,
			);
			return equal(ripemd160(sha256(publicKey)), payload(p.account.address));
		},
	});
}
export const bitcoinLegacyProfile = utxoMessageProfile({
	id: 'bitcoin-signmessage',
	reference: chains.bitcoin.reference,
	messagePrefix: 'Bitcoin Signed Message:\n',
	addressVersion: [0],
});
export const litecoinProfile = utxoMessageProfile({
	id: 'litecoin-signmessage',
	reference: chains.litecoin.reference,
	messagePrefix: 'Litecoin Signed Message:\n',
	addressVersion: [48],
});
export const zcashProfile = utxoMessageProfile({
	id: 'zcash-signmessage',
	reference: chains.zcash.reference,
	messagePrefix: 'Zcash Signed Message:\n',
	addressVersion: [0x1c, 0xb8],
});

function cardanoAddress(address: string): Uint8Array {
	const decoded = bech32.decode(address as `${string}1${string}`, 128);
	const raw = bech32.fromWords(decoded.words),
		kind = raw[0] >> 4;
	// CIP-19 base (key payment), enterprise, and reward addresses. No scripts/Byron/pointers.
	if (
		(raw[0] & 15) !== 1 ||
		![0, 2, 6, 14].includes(kind) ||
		raw.length !== ([0, 2].includes(kind) ? 57 : 29) ||
		decoded.prefix !== (kind === 14 ? 'stake' : 'addr') ||
		bech32.encode(decoded.prefix, decoded.words, 128) !== address
	)
		throw new ConnectError('invalidAccount');
	return raw;
}
function cbor(bytes: Uint8Array): unknown {
	return decode(bytes, {
		useMaps: true,
		rejectDuplicateMapKeys: true,
		strict: true,
		allowIndefinite: false,
		allowUndefined: false,
		tags: Object.assign([], { 18: (v: unknown) => v }),
	});
}
export const cardanoProfile = defineSigningProfile({
	id: 'cardano-cip8',
	namespace: 'cip34',
	alg: -19,
	validateAccount: (a) =>
		a.reference === chains.cardano.reference &&
		cardanoAddress(a.address).length > 0,
	verify(c, p) {
		const sign1 = cbor(hex(p.signature)),
			key = cbor(hex(p.publicKey));
		if (
			!Array.isArray(sign1) ||
			sign1.length !== 4 ||
			!(sign1[0] instanceof Uint8Array) ||
			!(sign1[1] instanceof Map) ||
			!(sign1[2] instanceof Uint8Array) ||
			!(sign1[3] instanceof Uint8Array)
		)
			return false;
		const [protectedBytes, unprotected, payload, signature] = sign1;
		const protectedMap = cbor(protectedBytes);
		if (
			!(protectedMap instanceof Map) ||
			protectedMap.size !== 2 ||
			protectedMap.get(1) !== -8 ||
			!(protectedMap.get('address') instanceof Uint8Array) ||
			unprotected.size !== 1 ||
			typeof unprotected.get('hashed') !== 'boolean'
		)
			return false;
		if (
			!(key instanceof Map) ||
			key.size !== 4 ||
			key.get(1) !== 1 ||
			key.get(3) !== -8 ||
			key.get(-1) !== 6 ||
			!(key.get(-2) instanceof Uint8Array) ||
			key.get(-2).length !== 32
		)
			return false;
		const publicKey: Uint8Array = key.get(-2),
			address = cardanoAddress(p.account.address);
		const expectedPayload = unprotected.get('hashed')
			? blake2b(message(c, p), { dkLen: 28 })
			: message(c, p);
		return (
			equal(protectedMap.get('address'), address) &&
			equal(address.slice(1, 29), blake2b(publicKey, { dkLen: 28 })) &&
			equal(payload, expectedPayload) &&
			signature.length === 64 &&
			ed25519.verify(
				signature,
				encode(['Signature1', protectedBytes, new Uint8Array(), payload]),
				publicKey,
				{ zip215: false },
			)
		);
	},
});
/** Offline monero-project WASM verification; spend-key SigV2 only.
 * Import and wallet allocation are deferred until a Monero proof arrives. */
export const moneroProfile = defineSigningProfile({
	id: 'monero-spend-v2',
	namespace: 'monero',
	alg: null,
	validateAccount: (a) =>
		a.reference === chains.monero.reference &&
		/^[48][1-9A-HJ-NP-Za-km-z]{94}$(?![\s\S])/.test(a.address),
	async verify(c, p) {
		if (
			p.publicKey !== undefined ||
			!/^SigV2[1-9A-HJ-NP-Za-km-z]{88}$(?![\s\S])/.test(p.signature)
		)
			return false;
		const imported = await import('monero-ts');
		// CommonJS exposes a default namespace in browser bundles.
		const monero = imported.default ?? imported;
		await monero.MoneroUtils.validateAddress(
			p.account.address,
			monero.MoneroNetworkType.MAINNET,
		);
		const wallet = await monero.createWalletFull({
			networkType: monero.MoneroNetworkType.MAINNET,
			proxyToWorker: false,
			// A disposable verification-only context; never expose/use this key for funds.
			// Explicit height avoids random-wallet initialization querying a daemon.
			privateSpendKey: '01' + '00'.repeat(31),
			restoreHeight: 0,
		});
		try {
			const result = await wallet.verifyMessage(
				canonicalMessage(c, p),
				p.account.address,
				p.signature,
			);
			return (
				result.getIsGood() &&
				!result.getIsOld() &&
				result.getVersion() === 2 &&
				result.getSignatureType() ===
					monero.MoneroMessageSignatureType.SIGN_WITH_SPEND_KEY
			);
		} finally {
			await wallet.close();
		}
	},
});
export const additionalProfiles: readonly SigningProfile[] = Object.freeze([
	solanaProfile,
	stellarProfile,
	tronProfile,
	rippleProfile,
	rippleEd25519Profile,
	bitcoinLegacyProfile,
	litecoinProfile,
	zcashProfile,
	cardanoProfile,
	moneroProfile,
]);
