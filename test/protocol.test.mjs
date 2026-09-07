import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	ConnectClient,
	parseConnectUri,
	canonicalMessage,
	validateChallenge,
} from '../dist/index.js';
const now = Date.parse('2026-09-07T10:00:00.000Z');
const id = 'a'.repeat(64);
const uri = `connect://example.com/connect/v1/${id}`;
const requirement = {
	namespace: 'raw',
	reference: 'ed25519',
	profile: 'raw-ed25519',
	alg: -19,
};
const challenge = () => ({
	version: 1,
	requestId: id,
	nonce: 'b'.repeat(64),
	domain: 'example.com',
	origin: 'https://example.com',
	issuedAt: new Date(now).toISOString(),
	expiresAt: new Date(now + 120000).toISOString(),
	requirements: [requirement],
});
const selection = {
	account: { namespace: 'raw', reference: 'ed25519', address: 'c'.repeat(64) },
	profile: 'raw-ed25519',
	alg: -19,
};
test('strict transport parity', () => {
	assert.deepEqual(
		parseConnectUri(uri),
		parseConnectUri(uri.replace('connect:', 'https:')),
	);
	for (const value of [
		uri + '\n',
		uri + '?redeemSecret=foo',
		uri + '#x',
		uri + '/',
		uri.replace('v1', 'v2'),
		uri.replace('example.com', 'user@example.com'),
		uri.replace('example.com', 'EXAMPLE.com'),
		uri.replace('example.com', '127.0.0.1'),
		uri.replace('example.com', 'example.com:443'),
		uri.replace('example.com', 'example.com.'),
		uri.replace('/connect/', '/x/../connect/'),
		uri.replace('connect:', 'http:'),
		uri.replace('example.com', '%65xample.com'),
		uri.replace('example.com', 'example.com\\evil'),
	])
		assert.throws(() => parseConnectUri(value), value);
});
test('challenge bindings, timestamps, fields and expiration', () => {
	assert.equal(
		validateChallenge(challenge(), parseConnectUri(uri), now).requestId,
		id,
	);
	for (const patch of [
		{ domain: 'evil.com' },
		{ origin: 'https://evil.com' },
		{ requestId: 'f'.repeat(64) },
		{ expiresAt: new Date(now).toISOString() },
		{ issuedAt: '2026-02-30T10:00:00.000Z' },
		{ version: 2 },
		{ redeemSecret: id },
		{ nonce: id + '\n' },
	])
		assert.throws(() =>
			validateChallenge(
				{ ...challenge(), ...patch },
				parseConnectUri(uri),
				now,
			),
		);
});
test('canonical payload binds each security field', () => {
	const c = challenge(),
		original = canonicalMessage(c, selection);
	for (const key of [
		'domain',
		'origin',
		'requestId',
		'nonce',
		'issuedAt',
		'expiresAt',
	]) {
		const mutated = {
			...c,
			[key]:
				key === 'domain'
					? 'other.com'
					: key === 'origin'
						? 'https://other.com'
						: key.endsWith('At')
							? '2026-09-07T10:00:01.000Z'
							: 'd'.repeat(64),
		};
		assert.notEqual(canonicalMessage(mutated, selection), original);
	}
	assert.throws(() => canonicalMessage(c, { ...selection, alg: 19 }));
	assert.throws(() =>
		canonicalMessage(c, { ...selection, profile: 'xcb-ed448' }),
	);
});
function walletSetup(
	sign = async () => ({ signature: '00' }),
	approve = async () => ({ status: 'APPROVED', requestId: id }),
) {
	const signer = { ...selection, sign };
	const client = new ConnectClient(
		{ getAccounts: async () => [signer] },
		{ challenge: async () => challenge(), approve },
		undefined,
		() => now,
	);
	return { client, signer };
}
test('explicit approval, frozen identity, transport acknowledgement and replay', async () => {
	let calls = 0;
	const { client, signer } = walletSetup(async () => {
		calls++;
		return { signature: '00' };
	});
	const r = await client.resolve(uri);
	assert.equal(calls, 0);
	assert.throws(() => {
		r.accounts[0].account.address = 'evil';
	});
	await assert.rejects(r.approve(signer));
	await r.approve(r.accounts[0]);
	assert.equal(r.state, 'approved');
	assert.equal(calls, 1);
	await assert.rejects(r.approve(r.accounts[0]));
	await assert.rejects(client.resolve(uri));
});
test('cancellation during signing never submits', async () => {
	let release,
		submitted = 0;
	const { client } = walletSetup(
		() => new Promise((r) => (release = r)),
		async () => {
			submitted++;
		},
	);
	const r = await client.resolve(uri);
	const approval = r.approve(r.accounts[0]);
	r.cancel();
	release({ signature: '00' });
	await assert.rejects(approval);
	assert.equal(submitted, 0);
	assert.equal(r.state, 'cancelled');
});
test('transport rejection does not report approval', async () => {
	const { client } = walletSetup(undefined, async () => ({
		status: 'APPROVED',
		requestId: 'f'.repeat(64),
	}));
	const r = await client.resolve(uri);
	await assert.rejects(r.approve(r.accounts[0]));
	assert.equal(r.state, 'failed');
});
test('shared conformance vectors are byte-identical', async () => {
	const { readFile } = await import('node:fs/promises');
	const vectors = JSON.parse(
		await readFile(new URL('./fixtures/conformance.json', import.meta.url)),
	);
	for (const v of vectors) {
		assert.equal(canonicalMessage(v.challenge, v.proof), v.canonical);
		assert.equal(Buffer.from(v.canonical).toString('hex'), v.canonicalHex);
	}
});

test('direct programmatic invocation validates and snapshots the target', async () => {
	const { client } = walletSetup();
	await assert.rejects(
		client.resolveTarget({ origin: 'http://example.com', requestId: id }),
	);
	const target = { origin: 'https://example.com', requestId: id };
	const pending = client.resolveTarget(target);
	target.origin = 'https://evil.com';
	const request = await pending;
	assert.equal(request.challenge.origin, 'https://example.com');
});
