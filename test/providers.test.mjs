import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	injectProviders,
	createProviderInfo,
	UniversalProvider,
	blockchainGlobals,
} from '../dist/providers.js';
import {
	discoverCoreWallets,
	discoverEthereumWallets,
} from '../dist/wallet/discovery.js';

test('all blockchain globals preserve incumbents, discovery is stable and isolated, cleanup is idempotent', () => {
	assert.equal(blockchainGlobals.monero, 'monero');
	assert.equal(blockchainGlobals.zcash, 'zcash');
	const target = new EventTarget();
	const incumbent = {};
	target.ethereum = incumbent;
	target.connect = incumbent;
	let calls = 0;
	const providers = Object.fromEntries(
		Object.keys(blockchainGlobals).map((key) => [
			key,
			{
				request: async () => {
					calls++;
				},
			},
		]),
	);
	const core = discoverCoreWallets(target);
	const eth = discoverEthereumWallets(target);
	const injection = injectProviders({
		target,
		providers,
		connect: {},
		info: {
			name: 'Custom',
			rdns: 'org.example',
			iconUrl: 'https://example.org/icon.png',
			custom: 7,
		},
	});
	assert.equal(core.get().length, 1);
	assert.equal(eth.get().length, 1);
	const first = core.get()[0];
	assert.equal(first.info.name, 'Custom');
	assert.equal(first.info.custom, 7);
	assert.ok(Object.isFrozen(first.info));
	assert.notEqual(first.info.uuid, eth.get()[0].info.uuid);
	core.refresh();
	assert.equal(core.get().length, 1);
	assert.equal(core.get()[0].info.uuid, first.info.uuid);
	assert.equal(calls, 0);
	for (const key of Object.keys(providers))
		assert.equal(target[key], key === 'ethereum' ? incumbent : providers[key]);
	assert.equal(target.connect, incumbent);
	injection.dispose();
	injection.dispose();
	assert.equal(target.core, undefined);
	assert.equal(target.ethereum, incumbent);
	core.dispose();
	eth.dispose();
	const late = discoverCoreWallets(target);
	assert.equal(late.get().length, 0);
	late.dispose();
});

test('late discovery and default identity; EVM data icons versus Core remote icons', () => {
	const target = new EventTarget();
	const injection = injectProviders({
		target,
		providers: { core: { request: async () => [] } },
		connect: {},
	});
	const late = discoverCoreWallets(target);
	assert.equal(late.get()[0].info.name, 'Connect Wallet Protocol');
	assert.equal(late.get()[0].info.rdns, 'connect.wallet');
	assert.ok(target.connect);
	assert.equal(
		createProviderInfo({ icon: 'ipfs://cid/icon.png' }).icon,
		'ipfs://cid/icon.png',
	);
	assert.throws(() =>
		createProviderInfo({ icon: 'https://example.org/a.png' }, 'ethereum'),
	);
	for (const info of [
		{ uuid: 'bad' },
		{ rdns: 'bad' },
		{ icon: 'http://example.org/a.png' },
		{ icon: 'javascript:alert(1)' },
	])
		assert.throws(() => createProviderInfo(info));
	injection.dispose();
	late.dispose();
});

test('universal operations route every method by default and override without changing default', async () => {
	const seen = [];
	const route = (namespace) => ({
		chain: { namespace, reference: '1' },
		transport: {
			async exchange(json) {
				const r = JSON.parse(json);
				seen.push(r);
				return JSON.stringify({
					version: 1,
					requestId: r.requestId,
					result: namespace,
				});
			},
		},
	});
	const provider = new UniversalProvider({
		core: route('core'),
		ethereum: route('eip155'),
	});
	assert.equal(
		await provider.operation('getBlock', { number: 'latest' }),
		'core',
	);
	assert.equal(
		await provider.operation('getBalance', {}, { blockchain: 'ethereum' }),
		'eip155',
	);
	assert.equal(provider.defaultBlockchain, 'core');
	provider.defaultBlockchain = 'ethereum';
	assert.equal(await provider.operation('getAccounts'), 'eip155');
	assert.deepEqual(seen[0].params, { number: 'latest' });
	await assert.rejects(
		provider.operation('getBlock', {}, { blockchain: 'ton' }),
	);
});

test('all universal methods preserve payloads and propagate operation errors', async () => {
	const { operationMethods } = await import('../dist/operations.js');
	let last;
	const transport = {
		async exchange(json) {
			last = JSON.parse(json);
			return JSON.stringify({
				version: 1,
				requestId: last.requestId,
				result: null,
			});
		},
	};
	const provider = new UniversalProvider({
		core: { chain: { namespace: 'core', reference: '1' }, transport },
	});
	for (const [name, method] of Object.entries(operationMethods)) {
		await provider.operation(name, { payload: 'chain-specific' });
		assert.equal(last.operation, method);
		assert.deepEqual(last.params, { payload: 'chain-specific' });
	}
	transport.exchange = async (json) =>
		JSON.stringify({
			version: 1,
			requestId: JSON.parse(json).requestId,
			error: { code: 'USER_REJECTED', message: 'User rejected the operation.' },
		});
	await assert.rejects(provider.operation('getAccounts'), {
		code: 'USER_REJECTED',
	});
});

test('invalid identity fails before changing globals; custom protocols are opt-in', () => {
	const target = new EventTarget();
	const provider = { request: async () => null };
	assert.throws(() =>
		injectProviders({
			target,
			providers: { ethereum: provider },
			connect: {},
			info: { icon: 'https://example.org/icon.png' },
		}),
	);
	assert.equal(target.connect, undefined);
	assert.equal(target.ethereum, undefined);
	let announcements = 0;
	target.addEventListener(
		'example6963:announceProvider',
		() => announcements++,
	);
	const injection = injectProviders({
		target,
		providers: { bitcoin: provider },
		connect: {},
		discoveryPrefixes: { bitcoin: 'example6963' },
	});
	assert.equal(announcements, 1);
	target.dispatchEvent(new Event('example6963:requestProvider'));
	assert.equal(announcements, 2);
	injection.dispose();
	target.dispatchEvent(new Event('example6963:requestProvider'));
	assert.equal(announcements, 2);
});
