import { validateWalletAddress } from 'blockchain-wallet-validator';
import {
	base58,
	base58check,
	base58xrp,
	base32,
	bech32,
	bech32m,
} from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

/** Address validity only: never proves ownership, account availability or network selection. */
export interface WalletAddressIdentity {
	readonly namespace: string;
	readonly reference: string;
	readonly address: string;
}
export type WalletValidationStatus = 'valid' | 'invalid' | 'unsupported';
export interface WalletValidationResult {
	readonly status: WalletValidationStatus;
}
const result = (status: WalletValidationStatus): WalletValidationResult =>
	Object.freeze({ status });
const valid = (value: boolean) => result(value ? 'valid' : 'invalid');
const referenceNetworks: Readonly<Record<string, string>> = Object.freeze({
	'core:1': 'xcb',
	'core:3': 'xab',
	'bip122:000000000019d6689c085ae165831e93': 'btc',
	'bip122:12a765e31ffd4059bada1e25190f6e98': 'ltc',
	'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'sol',
	'tron:728126428': 'trx',
	'xrpl:0': 'xrp',
	'stellar:pubnet': 'xlm',
	'cip34:1-764824073': 'ada',
});
const check = base58check(sha256);
function segwit(address: string, hrp: string): boolean {
	let decoded;
	try {
		decoded = bech32.decode(address as `${string}1${string}`, 90);
	} catch {
		decoded = bech32m.decode(address as `${string}1${string}`, 90);
	}
	const version = decoded.words[0];
	const codec = version === 0 ? bech32 : bech32m;
	if (codec.encode(decoded.prefix, decoded.words, 90) !== address.toLowerCase())
		return false;
	const bytes = codec.fromWords(decoded.words.slice(1));
	return (
		decoded.prefix === hrp &&
		version >= 0 &&
		version <= 16 &&
		bytes.length >= 2 &&
		bytes.length <= 40 &&
		(version !== 0 || bytes.length === 20 || bytes.length === 32)
	);
}
function cardano(address: string): WalletValidationResult {
	const decoded = bech32.decode(address as `${string}1${string}`, 128);
	const bytes = bech32.fromWords(decoded.words),
		type = bytes[0] >> 4;
	if (
		(bytes[0] & 15) !== 1 ||
		!['addr', 'stake'].includes(decoded.prefix) ||
		address !== bech32.encode(decoded.prefix, decoded.words, 128)
	)
		return result('invalid');
	if (type <= 3) return valid(decoded.prefix === 'addr' && bytes.length === 57);
	if (type === 6 || type === 7)
		return valid(decoded.prefix === 'addr' && bytes.length === 29);
	if (type === 14 || type === 15)
		return valid(decoded.prefix === 'stake' && bytes.length === 29);
	return result('unsupported');
}
/** Pinned package integration with explicit chain mapping and codec checks for package gaps.
 * Unsupported references/formats must be handled by a host chain validator, never treated as valid. */
export function validateWalletAccount(
	account: WalletAddressIdentity,
): WalletValidationResult {
	try {
		if (
			!account ||
			![account.namespace, account.reference, account.address].every(
				(v) =>
					typeof v === 'string' && /^[a-zA-Z0-9._-]{1,128}(?![\s\S])/.test(v),
			)
		)
			return result('invalid');
		const { namespace, reference, address } = account;
		const network =
			namespace === 'eip155'
				? 'evm'
				: referenceNetworks[`${namespace}:${reference}`];
		if (!network) return result('unsupported');
		if (network === 'evm' && !/^[1-9][0-9]{0,14}(?![\s\S])/.test(reference))
			return result('invalid');
		// No ENS/name-service resolution, autodetection, whitespace removal or identity rewriting.
		const body = address.slice(2);
		const packageAddress =
			network === 'evm' &&
			(body === body.toUpperCase() || body === body.toLowerCase())
				? address.toLowerCase()
				: address;
		const upstream = validateWalletAddress(packageAddress, {
			network: [network],
			testnet: network === 'xab',
			enabledLegacy: true,
			nsDomains: [],
		});
		if (network === 'evm')
			return valid(
				/^0x[0-9a-fA-F]{40}(?![\s\S])/.test(address) && upstream.isValid,
			);
		if (network === 'xcb' || network === 'xab')
			return valid(
				address.slice(0, 2).toLowerCase() ===
					(network === 'xcb' ? 'cb' : 'ab') && upstream.isValid,
			);
		if (network === 'btc' || network === 'ltc') {
			const hrp = network === 'btc' ? 'bc' : 'ltc';
			if (address.toLowerCase().startsWith(hrp + '1'))
				return valid(segwit(address, hrp));
			const bytes = check.decode(address),
				versions = network === 'btc' ? [0, 5] : [48, 50];
			return valid(bytes.length === 21 && versions.includes(bytes[0]));
		}
		if (network === 'sol') return valid(base58.decode(address).length === 32);
		if (network === 'trx') {
			const bytes = check.decode(address);
			return valid(bytes.length === 21 && bytes[0] === 65);
		}
		if (network === 'xrp') {
			const bytes = base58xrp.decode(address),
				payload = bytes.slice(0, -4),
				checksum = sha256(sha256(payload));
			return valid(
				bytes.length === 25 &&
					bytes[0] === 0 &&
					bytes.slice(-4).every((b, i) => b === checksum[i]),
			);
		}
		if (network === 'xlm') {
			const bytes = base32.decode(address);
			let crc = 0;
			for (const byte of bytes.slice(0, -2)) {
				crc ^= byte << 8;
				for (let i = 0; i < 8; i++)
					crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 65535;
			}
			return valid(
				bytes.length === 35 &&
					bytes[0] === 48 &&
					bytes[33] === (crc & 255) &&
					bytes[34] === crc >> 8 &&
					base32.encode(bytes) === address,
			);
		}
		if (network === 'ada') return cardano(address);
		return result('unsupported');
	} catch {
		return result('invalid');
	}
}
export function isValidWalletAccount(account: WalletAddressIdentity): boolean {
	return validateWalletAccount(account).status === 'valid';
}
