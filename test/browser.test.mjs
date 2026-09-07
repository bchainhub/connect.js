import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import {
	BrowserConnect,
	signBrowserChallenge,
	decodeBrowserChallenge,
	encodeBrowserProof,
	chains,
	ethereumAccountProvider,
	requestEthereumAccounts,
} from '../dist/index.js';
const origin = 'https://example.com';
const signer = privateKeyToAccount('0x' + '01'.repeat(32));
function injectedWallet() {
	const state = {
		network: '0x1',
		accounts: [signer.address],
		calls: [],
		afterSign: () => {},
	};
	const provider = {
		async request({ method, params }) {
			state.calls.push(method);
			if (method === 'eth_chainId') return state.network;
			if (method === 'eth_accounts' || method === 'eth_requestAccounts')
				return state.accounts;
			if (method === 'personal_sign') {
				assert.equal(params[1], signer.address);
				const signature = await signer.signMessage({
					message: { raw: params[0] },
				});
				state.afterSign();
				return signature;
			}
			throw new Error('Unexpected wallet method ' + method);
		},
	};
	return { state, provider };
}
test('main import is the browser API and legacy HTTP APIs are absent', async () => {
	const sdk = await import('connect.js');
	assert.equal(typeof sdk.BrowserConnect, 'function');
	for (const name of [
		'ConnectEngine',
		'createConnectServer',
		'MemoryRequestStore',
		'ConnectDappClient',
		'HttpsNetwork',
	])
		assert.ok(!(name in sdk));
	for (const subpath of ['server', 'dapp', 'browser'])
		await assert.rejects(import('connect.js/' + subpath), {
			code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
		});
});
test('an injected wallet signs and authenticates locally after explicit approval', async () => {
	const { state, provider } = injectedWallet();
	const request = new BrowserConnect({
		origin,
		chains: [chains.ethereum],
	}).create();
	const adapter = ethereumAccountProvider(provider, chains.ethereum);
	const [account] = await adapter.getAccounts();
	assert.ok(!state.calls.includes('personal_sign'));
	assert.ok(!state.calls.includes('eth_requestAccounts'));
	assert.deepEqual(await requestEthereumAccounts(provider), [signer.address]);
	const proof = await signBrowserChallenge(request.challenge, account);
	assert.equal(
		(await request.verify(encodeBrowserProof(proof))).address,
		signer.address,
	);
	assert.equal(request.status, 'CONSUMED');
	await assert.rejects(() => request.verify(proof));
});
test('injected wallets reject chain or account changes before and during signing', async () => {
	for (const change of ['chain-before', 'chain-during', 'account-during']) {
		const { state, provider } = injectedWallet();
		const request = new BrowserConnect({
			origin,
			chains: [chains.ethereum],
		}).create();
		const [account] = await ethereumAccountProvider(
			provider,
			chains.ethereum,
		).getAccounts();
		if (change === 'chain-before') state.network = '0x89';
		else
			state.afterSign = () => {
				if (change === 'chain-during') state.network = '0x89';
				else state.accounts = [];
			};
		await assert.rejects(
			() => signBrowserChallenge(request.challenge, account),
			change,
		);
		assert.equal(request.status, 'PENDING');
	}
});
test('browser envelopes pin origin and reject malformed or substituted proofs', async () => {
	const request = new BrowserConnect({
		origin,
		chains: [chains.ethereum],
	}).create();
	const payload = request.exportChallenge();
	assert.throws(() => decodeBrowserChallenge(payload, 'https://other.example'));
	assert.throws(() =>
		decodeBrowserChallenge(
			JSON.stringify({ ...JSON.parse(payload), extra: true }),
			origin,
		),
	);
	const decoded = decodeBrowserChallenge(payload, origin);
	assert.throws(() => {
		decoded.requirements[0].reference = '137';
	});
	const { provider } = injectedWallet();
	const [account] = await ethereumAccountProvider(
		provider,
		chains.ethereum,
	).getAccounts();
	const proof = await signBrowserChallenge(decoded, account);
	await assert.rejects(() => request.verify({ ...proof, alg: -53 }));
	await assert.rejects(() =>
		request.verify({ ...proof, signature: '0x' + '00'.repeat(65) }),
	);
	assert.equal(request.status, 'PENDING');
	await request.verify(proof);
});
