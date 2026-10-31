import type { Blockchain } from '../providers.js';
import { InvalidTransactionError, NetworkMismatchError } from './errors.js';
export function requestObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new InvalidTransactionError('Expected a native request object.');
	return value as Record<string, unknown>;
}
export function quantity(value: unknown): bigint {
	try {
		if (typeof value === 'number' && !Number.isSafeInteger(value))
			throw new Error();
		if (
			!['string', 'number', 'bigint'].includes(typeof value) ||
			!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(String(value))
		)
			throw new Error();
		const result = BigInt(String(value));
		if (result < 0n) throw new Error();
		return result;
	} catch {
		throw new InvalidTransactionError(
			'Expected a nonnegative integer quantity.',
		);
	}
}
export function hexQuantity(value: unknown): `0x${string}` {
	return `0x${quantity(value).toString(16)}`;
}
export function messageBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (typeof value === 'string') return new TextEncoder().encode(value);
	throw new InvalidTransactionError('Message must be a string or bytes.');
}
export function hexBytes(value: Uint8Array): `0x${string}` {
	return `0x${Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
export function coreAddressValid(value: unknown): value is string {
	if (typeof value === 'string') value = value.replace(/^0x/i, '');
	if (typeof value === 'string' && /^0{43}[0-9]$/.test(value)) return true;
	if (
		typeof value !== 'string' ||
		!/^[a-f]{2}[0-9]{2}[0-9a-f]{40}$/i.test(value)
	)
		return false;
	const rearranged = value.slice(4) + value.slice(0, 4);
	return (
		BigInt([...rearranged].map((c) => parseInt(c, 16).toString()).join('')) %
			97n ===
		1n
	);
}
export function validateAddress(
	value: unknown,
	blockchain: 'ethereum' | 'core',
	network?: unknown,
): string {
	if (
		blockchain === 'core'
			? !coreAddressValid(value)
			: typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value)
	)
		throw new InvalidTransactionError(`Invalid ${blockchain} address.`);
	const address =
		blockchain === 'core'
			? (value as string).replace(/^0x/i, '')
			: (value as string);
	if (blockchain === 'core' && network !== undefined) {
		const id = quantity(network);
		const prefix =
			id === 1n
				? 'cb'
				: id === 3n || id === 4n
					? 'ab'
					: id >= 10n
						? 'ce'
						: undefined;
		if (!prefix)
			throw new InvalidTransactionError(
				'Unassigned Core network ID; private networks start at 10.',
			);
		if (
			!/^0{43}[0-9]$/.test(address) &&
			!address.toLowerCase().startsWith(prefix)
		)
			throw new NetworkMismatchError(
				'ICAN prefix does not match the selected Core network.',
			);
	}
	return address;
}
export function canonicalNetwork(
	value: unknown,
	blockchain: Blockchain,
): string {
	return ['ethereum', 'core'].includes(blockchain) &&
		/^(0x[0-9a-f]+|[0-9]+)$/i.test(String(value))
		? quantity(value).toString()
		: String(value);
}
export function networkMatches(
	value: unknown,
	expected: string | number,
	blockchain: Blockchain,
): boolean {
	if (value && typeof value === 'object') {
		const r = value as Record<string, unknown>;
		const numeric = /^(0x[0-9a-f]+|[0-9]+)$/i.test(String(expected));
		if (['bitcoin', 'litecoin'].includes(blockchain) && r.enum !== undefined)
			return networkMatches(r.enum, expected, blockchain);
		const keys =
			blockchain === 'core'
				? ['networkId', 'chainId', 'id', 'name', 'network']
				: numeric
					? ['chainId', 'networkId', 'id', 'chain', 'name', 'network']
					: [
							'name',
							'network',
							'cluster',
							'chainId',
							'networkId',
							'chain',
							'id',
						];
		for (const key of keys)
			if (r[key] !== undefined)
				return networkMatches(r[key], expected, blockchain);
		return false;
	}
	return (
		canonicalNetwork(value, blockchain) ===
		canonicalNetwork(expected, blockchain)
	);
}
export function payloadNetwork(
	input: unknown,
	blockchain: Blockchain,
): string | number | undefined {
	if (!input || typeof input !== 'object') return;
	const r = input as Record<string, unknown>;
	const domain =
		r.domain && typeof r.domain === 'object'
			? (r.domain as Record<string, unknown>)
			: undefined;
	const value =
		blockchain === 'core'
			? (r.networkId ?? domain?.networkId)
			: blockchain === 'ethereum'
				? (r.chainId ?? domain?.chainId)
				: undefined;
	if (value === undefined) return;
	if (typeof value === 'bigint') return value.toString();
	if (typeof value !== 'string' && typeof value !== 'number')
		throw new InvalidTransactionError('Invalid payload network identifier.');
	return value;
}
export function assertPayloadNetwork(
	input: unknown,
	expected: string | number | undefined,
	blockchain: Blockchain,
): string | number | undefined {
	const payload = payloadNetwork(input, blockchain);
	if (
		payload !== undefined &&
		expected !== undefined &&
		!networkMatches(payload, expected, blockchain)
	)
		throw new NetworkMismatchError(
			'Transaction or signing domain conflicts with the requested network.',
		);
	return expected ?? payload;
}

export function sameWalletAddress(
	a: string | undefined,
	b: string | undefined,
	blockchain: Blockchain,
): boolean {
	if (a === undefined || b === undefined) return false;
	if (blockchain === 'core')
		return (
			a.replace(/^0x/i, '').toLowerCase() ===
			b.replace(/^0x/i, '').toLowerCase()
		);
	return blockchain === 'ethereum'
		? a.toLowerCase() === b.toLowerCase()
		: a === b;
}
