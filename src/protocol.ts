import { z } from 'zod';

export const COSE = Object.freeze({ Ed448: -53, Ed25519: -19 });
export class ConnectError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = 'ConnectError';
	}
}
export const idSchema = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);
const atom = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9._-]+(?![\s\S])/);
export const accountSchema = z
	.object({ namespace: atom, reference: atom, address: atom })
	.strict();
export const requirementSchema = z
	.object({
		profile: atom,
		alg: z.number().int().nullable(),
		namespace: atom,
		reference: atom,
	})
	.strict();
export const challengeSchema = z
	.object({
		version: z.literal(1),
		requestId: idSchema,
		nonce: idSchema,
		domain: z.string().min(1).max(253),
		origin: z.string().max(261),
		issuedAt: z.string().datetime({ precision: 3 }),
		expiresAt: z.string().datetime({ precision: 3 }),
		requirements: z.array(requirementSchema).min(1).max(32),
	})
	.strict();
export const proofSchema = z
	.object({
		requestId: idSchema,
		account: accountSchema,
		profile: atom,
		alg: z.number().int().nullable(),
		signature: z.string().min(1).max(4096),
		publicKey: z.string().max(256).optional(),
	})
	.strict();
export type Account = z.infer<typeof accountSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type Challenge = z.infer<typeof challengeSchema>;
export type Proof = z.infer<typeof proofSchema>;
export type Selection = Pick<Proof, 'account' | 'profile' | 'alg'>;
export interface ConnectTarget {
	origin: string;
	requestId: string;
}

export function validDomain(domain: string): boolean {
	return (
		domain.length <= 253 &&
		domain.includes('.') &&
		domain
			.split('.')
			.every((label) =>
				/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?![\s\S])/.test(label),
			) &&
		!/^\d+(\.\d+){3}(?![\s\S])/.test(domain)
	);
}
export function validateOrigin(origin: string): string {
	if (!origin.startsWith('https://') || !validDomain(origin.slice(8)))
		throw new ConnectError('invalidUri');
	return origin;
}
/** Strict canonical syntax avoids URL parser normalization differences across platforms. */
export function parseConnectUri(
	input: string,
	schemes: readonly string[] = ['connect', 'https'],
): ConnectTarget {
	if (input.length > 512) throw new ConnectError('invalidUri');
	const match =
		/^([a-z][a-z0-9+.-]*):\/\/([^/]+)\/connect\/v1\/([a-f0-9]{64})(?![\s\S])/.exec(
			input,
		);
	if (!match || !schemes.includes(match[1]) || !validDomain(match[2]))
		throw new ConnectError('invalidUri');
	return Object.freeze({ origin: `https://${match[2]}`, requestId: match[3] });
}
export function connectUri(target: ConnectTarget): string {
	validateOrigin(target.origin);
	idSchema.parse(target.requestId);
	return `connect://${target.origin.slice(8)}/connect/v1/${target.requestId}`;
}
export function validateChallenge(
	input: unknown,
	target?: ConnectTarget,
	now = Date.now(),
): Challenge {
	const result = challengeSchema.safeParse(input);
	if (!result.success) throw new ConnectError('invalidChallenge');
	const c = result.data;
	validateOrigin(c.origin);
	if (
		c.domain !== c.origin.slice(8) ||
		(target && (target.origin !== c.origin || target.requestId !== c.requestId))
	)
		throw new ConnectError('domainMismatch');
	const issued = Date.parse(c.issuedAt),
		expires = Date.parse(c.expiresAt);
	if (
		new Date(issued).toISOString() !== c.issuedAt ||
		new Date(expires).toISOString() !== c.expiresAt ||
		expires <= issued ||
		expires - issued > 300_000 ||
		issued > now + 30_000
	)
		throw new ConnectError('invalidChallenge');
	if (expires <= now) throw new ConnectError('expiredRequest');
	return Object.freeze({
		...c,
		requirements: Object.freeze(c.requirements.map((r) => Object.freeze(r))),
	}) as Challenge;
}
export function compatible(c: Challenge, s: Selection): boolean {
	return c.requirements.some(
		(r) =>
			r.profile === s.profile &&
			r.alg === s.alg &&
			r.namespace === s.account.namespace &&
			r.reference === s.account.reference,
	);
}
export function canonicalMessage(c: Challenge, selection: Selection): string {
	challengeSchema.parse(c);
	accountSchema.parse(selection.account);
	if (!compatible(c, selection)) throw new ConnectError('unsupportedProfile');
	const { account: a, profile, alg } = selection;
	const resources = [
		`urn:connect:version:1`,
		`urn:connect:profile:${profile}`,
		`urn:connect:alg:${alg ?? 'none'}`,
		`urn:connect:account:${a.namespace}:${a.reference}:${a.address}`,
	];
	if (profile === 'ethereum-siwe') {
		if (
			!/^[1-9][0-9]{0,14}(?![\s\S])/.test(a.reference) ||
			!/^0x[0-9a-fA-F]{40}(?![\s\S])/.test(a.address)
		)
			throw new ConnectError('invalidAccount');
		return `${c.domain} wants you to sign in with your Ethereum account:\n${a.address}\n\nApprove this Connect sign-in request.\n\nURI: ${c.origin}\nVersion: 1\nChain ID: ${a.reference}\nNonce: ${c.nonce}\nIssued At: ${c.issuedAt}\nExpiration Time: ${c.expiresAt}\nRequest ID: ${c.requestId}\nResources:\n${resources.map((r) => `- ${r}`).join('\n')}`;
	}
	return [
		'Connect Authentication',
		'Version: 1',
		`Domain: ${c.domain}`,
		`URI: ${c.origin}`,
		`Account: ${a.namespace}:${a.reference}:${a.address}`,
		`Profile: ${profile}`,
		`Algorithm: ${alg ?? 'none'}`,
		`Nonce: ${c.nonce}`,
		`Request ID: ${c.requestId}`,
		`Issued At: ${c.issuedAt}`,
		`Expiration Time: ${c.expiresAt}`,
	].join('\n');
}
export function canonicalBytes(c: Challenge, s: Selection): Uint8Array {
	return new TextEncoder().encode(canonicalMessage(c, s));
}
