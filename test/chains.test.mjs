import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	allChains,
	chains,
	requirementsFor,
	accountFor,
	walletAccount,
	canonicalMessage,
	evmChain,
	defineChain,
} from '../dist/index.js';
test('every chain preset agrees with shared canonical proof fixtures', () => {
	const vectors = JSON.parse(
		readFileSync(new URL('./fixtures/conformance.json', import.meta.url)),
	);
	assert.equal(allChains.length, 16);
	for (const chain of allChains) {
		const v = vectors.find(
			(v) =>
				v.proof.profile === chain.profile &&
				v.proof.account.reference === chain.reference,
		);
		assert.ok(v, chain.name);
		const selection = accountFor(chain, v.proof.account.address);
		assert.equal(canonicalMessage(v.challenge, selection), v.canonical);
		assert.ok(Object.isFrozen(chain));
	}
	assert.equal(requirementsFor([chains.solana, chains.solana]).length, 1);
});
test('wallet adapter signs unchanged bytes and custom EVM chains need no new verifier', async () => {
	const bytes = new TextEncoder().encode('Connect Authentication');
	const wallet = walletAccount(chains.solana, 'address', async (received) => {
		assert.equal(received, bytes);
		return { signature: 'signature' };
	});
	assert.deepEqual(await wallet.sign(bytes), { signature: 'signature' });
	assert.equal(wallet.profile, 'solana-ed25519');
	assert.equal(evmChain('Arbitrum', 42161).reference, '42161');
	assert.throws(() => evmChain('invalid', Number.MAX_SAFE_INTEGER + 1));
	assert.throws(() => defineChain({ ...chains.core, reference: 'invalid\n' }));
});
