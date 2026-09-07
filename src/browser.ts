import { ProfileRegistry } from './verification/profiles.js';
import {
	ConnectError,
	validateOrigin,
	validateChallenge,
	proofSchema,
	compatible,
	canonicalBytes,
	requirementSchema,
	type Account,
	type Challenge,
	type Proof,
	type Requirement,
} from './protocol.js';
import { allChains, requirementsFor, type ChainDefinition } from './chains.js';
import type { WalletAccount } from './wallet.js';
export { ProfileRegistry, builtInProfiles } from './verification/profiles.js';
export type { SigningProfile } from './verification/profiles.js';
export { defineSigningProfile } from './verification/multichain.js';
export { chains, allChains, evmChain } from './chains.js';
export type { Account, Challenge, Proof } from './protocol.js';

export interface BrowserConnectOptions {
	/** HTTPS relying-party origin. Defaults to location.origin; extensions pass the trusted requesting site's origin. */
	origin?: string;
	chains?: readonly ChainDefinition[];
	requirements?: readonly Requirement[];
	registry?: ProfileRegistry;
	ttlMs?: number;
	/** Clock injection for deterministic tests. */
	now?: () => number;
}
export type BrowserRequestStatus =
	'PENDING' | 'CONSUMED' | 'CANCELLED' | 'EXPIRED';

function freezeChallenge(c: Challenge): Challenge {
	c.requirements.forEach(Object.freeze);
	Object.freeze(c.requirements);
	return Object.freeze(c);
}
const randomId = () =>
	Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
		b.toString(16).padStart(2, '0'),
	).join('');
const MAX_ENVELOPE = 16384;
function parseEnvelope(input: string, type: string): unknown {
	if (input.length > MAX_ENVELOPE) throw new ConnectError('malformedEnvelope');
	try {
		const value = JSON.parse(input);
		if (
			!value ||
			value.type !== type ||
			Object.keys(value).length !== 2 ||
			!('payload' in value)
		)
			throw new Error();
		return value.payload;
	} catch {
		throw new ConnectError('malformedEnvelope');
	}
}
/** Self-contained challenge, suitable for copy/paste, extension messaging or QR transport. */
export function encodeBrowserChallenge(challenge: Challenge): string {
	return JSON.stringify({
		type: 'connect:challenge:1',
		payload: validateChallenge(challenge),
	});
}
/** expectedOrigin must come from a trusted channel or the wallet's explicit origin confirmation, never from an untrusted envelope. */
export function decodeBrowserChallenge(
	input: string,
	expectedOrigin: string,
	now = Date.now(),
): Challenge {
	const value = parseEnvelope(input, 'connect:challenge:1');
	const c = validateChallenge(value, undefined, now);
	if (c.origin !== validateOrigin(expectedOrigin))
		throw new ConnectError('originMismatch');
	return freezeChallenge(c);
}
export function encodeBrowserProof(proof: Proof): string {
	return JSON.stringify({
		type: 'connect:proof:1',
		payload: proofSchema.parse(proof),
	});
}
export function decodeBrowserProof(input: string): Proof {
	const result = proofSchema.safeParse(parseEnvelope(input, 'connect:proof:1'));
	if (!result.success) throw new ConnectError('malformedProof');
	return result.data;
}
/** Call only after the wallet user approves the displayed challenge and account. No networking or storage. */
export async function signBrowserChallenge(
	input: Challenge,
	account: WalletAccount,
	now = Date.now,
): Promise<Proof> {
	const challenge = freezeChallenge(validateChallenge(input, undefined, now()));
	// Capture the account identity before invoking an external wallet.
	const selection = {
		account: { ...account.account },
		profile: account.profile,
		alg: account.alg,
	};
	if (!compatible(challenge, selection))
		throw new ConnectError('noCompatibleAccount');
	const signed = await account.sign(canonicalBytes(challenge, selection));
	validateChallenge(challenge, undefined, now());
	return proofSchema.parse({
		requestId: challenge.requestId,
		...selection,
		signature: signed.signature,
		...(signed.publicKey === undefined ? {} : { publicKey: signed.publicKey }),
	});
}

/** A single, browser-owned challenge. Keep this object in memory until the response arrives. */
export class BrowserConnectRequest {
	#status: BrowserRequestStatus = 'PENDING';
	#challenge: Challenge;
	get challenge(): Challenge {
		return this.#challenge;
	}
	constructor(
		challenge: Challenge,
		private readonly registry: ProfileRegistry,
		private readonly now: () => number,
	) {
		this.#challenge = freezeChallenge(
			validateChallenge(challenge, undefined, now()),
		);
	}
	get status(): BrowserRequestStatus {
		if (
			this.#status === 'PENDING' &&
			Date.parse(this.challenge.expiresAt) <= this.now()
		)
			this.#status = 'EXPIRED';
		return this.#status;
	}
	private pending() {
		if (this.status !== 'PENDING')
			throw new ConnectError(
				this.status === 'EXPIRED' ? 'expiredRequest' : 'invalidState',
			);
	}
	cancel(): void {
		this.pending();
		this.#status = 'CANCELLED';
	}
	/** Full challenge, not an HTTP lookup URI. Large payloads may need animated/multiple QR frames. */
	exportChallenge(): string {
		this.pending();
		return JSON.stringify({
			type: 'connect:challenge:1',
			payload: this.challenge,
		});
	}
	/** Verify against this locally created challenge, then consume it once. */
	async verify(input: unknown): Promise<Account> {
		this.pending();
		const result = proofSchema.safeParse(
			typeof input === 'string' ? decodeBrowserProof(input) : input,
		);
		if (!result.success) throw new ConnectError('malformedProof');
		const proof = result.data;
		if (
			proof.requestId !== this.challenge.requestId ||
			!compatible(this.challenge, proof)
		)
			throw new ConnectError('unsupportedAccount');
		const profile = this.registry.get(proof.profile);
		if (
			profile.alg !== proof.alg ||
			profile.namespace !== proof.account.namespace ||
			!profile.validateAccount(proof.account)
		)
			throw new ConnectError('unsupportedAccount');
		let account: Account;
		try {
			account = await profile.verify(this.challenge, proof);
		} catch {
			throw new ConnectError('invalidProof');
		}
		if (
			account.namespace !== proof.account.namespace ||
			account.reference !== proof.account.reference ||
			account.address !== proof.account.address
		)
			throw new ConnectError('invalidProof');
		// No await between rechecking state and consumption: concurrent approvals cannot both succeed.
		this.pending();
		this.#status = 'CONSUMED';
		return Object.freeze({ ...account });
	}
}

/** Local challenge creation and verification. No server, database, RPC, fetch or persistent storage. */
export class BrowserConnect {
	private readonly origin: string;
	private readonly registry: ProfileRegistry;
	private readonly requirements: Requirement[];
	private readonly ttl: number;
	private readonly now: () => number;
	constructor(options: BrowserConnectOptions = {}) {
		this.origin = validateOrigin(
			options.origin ?? globalThis.location?.origin ?? '',
		);
		this.registry = options.registry ?? new ProfileRegistry();
		this.now = options.now ?? Date.now;
		this.ttl = options.ttlMs ?? 120000;
		if (options.chains && options.requirements)
			throw new ConnectError('invalidConfiguration');
		const requirements =
			options.requirements ?? requirementsFor(options.chains ?? allChains);
		if (
			!Number.isInteger(this.ttl) ||
			this.ttl < 1000 ||
			this.ttl > 300000 ||
			!requirements.length ||
			requirements.length > 32
		)
			throw new ConnectError('invalidConfiguration');
		this.requirements = requirements.map((value) => {
			const r = requirementSchema.parse(value),
				profile = this.registry.get(r.profile);
			if (r.alg !== profile.alg || r.namespace !== profile.namespace)
				throw new ConnectError('invalidConfiguration');
			return r;
		});
	}
	create(): BrowserConnectRequest {
		const now = this.now();
		return new BrowserConnectRequest(
			{
				version: 1,
				requestId: randomId(),
				nonce: randomId(),
				origin: this.origin,
				domain: this.origin.slice(8),
				issuedAt: new Date(now).toISOString(),
				expiresAt: new Date(now + this.ttl).toISOString(),
				requirements: this.requirements,
			},
			this.registry,
			this.now,
		);
	}
}

export * from './wallet/index.js';
