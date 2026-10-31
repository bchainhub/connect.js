import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	createNativeWalletAdapter,
	UniversalWalletProvider,
	installWalletProvider,
	ethereumRpcMethods,
	ProviderNotFoundError,
	UnsupportedMethodError,
	WalletNotConnectedError,
	UserRejectedRequestError,
	NetworkMismatchError,
	InvalidTransactionError,
} from '../dist/wallet-provider.js';
import { createProviderInfo } from '../dist/providers.js';
const address = '0x' + 'a'.repeat(40);
const make = (blockchain, native, opts = {}) =>
	createNativeWalletAdapter(blockchain, native, {
		id: `${blockchain}:test`,
		...opts,
	});

test('all eleven native adapters preserve payload types and capability boundaries', async () => {
	for (const blockchain of [
		'core',
		'solana',
		'bitcoin',
		'litecoin',
		'aptos',
		'ton',
		'near',
		'monero',
		'zcash',
	]) {
		let payload;
		const native = {
			connect: async () => [address],
			getAccounts: async () => [address],
			signTransaction: async (tx) => {
				payload = tx;
				return tx;
			},
		};
		if (blockchain === 'solana') native.publicKey = { toBase58: () => address };
		if (blockchain === 'ton') native.account = { address, chain: '-239' };
		const adapter = make(blockchain, native);
		const api = new UniversalWalletProvider([adapter]);
		assert.equal(adapter.connected, false);
		await assert.rejects(
			api.signTransaction({ native: true }),
			WalletNotConnectedError,
		);
		await api.connect();
		assert.equal(api.getConnectedBlockchain(), blockchain);
		const tx = Object.assign(Object.create({ version: 'native' }), {
			body: blockchain,
		});
		assert.equal(await api.signTransaction(tx), tx);
		assert.equal(payload, tx);
		assert.ok(api.getCapabilities().methods.includes('signTransaction'));
		await assert.rejects(api.deployContract({}), UnsupportedMethodError);
		await api.disconnect();
		assert.equal(api.isConnected(), false);
		api.dispose();
	}
	const calls = [];
	const evm = make(
		'ethereum',
		{
			request: async (r) => {
				calls.push(r);
				return r.method === 'eth_chainId'
					? '0x1'
					: r.method === 'eth_sendTransaction'
						? '0xhash'
						: [address];
			},
		},
		{ rpcMethods: ethereumRpcMethods },
	);
	const api = new UniversalWalletProvider([evm]);
	await api.connect();
	assert.equal(await api.getChainId(), '0x1');
	assert.equal(
		await api.sendTransaction({ to: address, value: '0x1' }),
		'0xhash',
	);
	assert.deepEqual(calls.at(-1).params, [
		{ to: address, value: '0x1', from: address },
	]);
	await api.signMessage('hello');
	assert.deepEqual(calls.at(-1).params, ['0x68656c6c6f', address]);
	await api.switchNetwork(5);
	assert.deepEqual(calls.at(-1).params, [{ chainId: '0x5' }]);
	await api.addNetwork({ chainId: '0x5', rpcUrls: ['https://rpc.example'] });
	await api.watchAsset({ type: 'ERC20', options: { address } });
	await api.signTypedData({ domain: {}, message: {} });
	assert.equal(calls.at(-1).method, 'eth_signTypedData_v4');
	await api.callContract({ to: address, data: '0x' });
	assert.equal(calls.at(-1).method, 'eth_call');
	await api.estimateGas({ to: address });
	await api.getTransactionReceipt('0xhash');
	await assert.rejects(
		api.sendTransaction({ to: 'invalid' }),
		InvalidTransactionError,
	);
	await assert.rejects(
		api.getBalance({ network: '0x2' }),
		NetworkMismatchError,
	);
	assert.equal(await api.request({ method: 'eth_chainId' }), '0x1');
	await assert.rejects(
		api.request({ method: 'xcb_accounts' }),
		UnsupportedMethodError,
	);
	api.dispose();
});

test('CIP-30 enables only the chosen wallet and refreshes post-enable capabilities', async () => {
	const calls = [];
	const authorized = {
		getUsedAddresses: async () => ['cborAddress'],
		getUnusedAddresses: async () => [],
		getChangeAddress: async () => 'cborChange',
		getRewardAddresses: async () => ['reward'],
		getNetworkId: async () => 1,
		getBalance: async () => 'cborValue',
		getUtxos: async () => ['cborUtxo'],
		signTx: async (...args) => {
			calls.push(args);
			return 'witnessCBOR';
		},
		signData: async (...args) => args,
		submitTx: async (cbor) => cbor,
	};
	let enabled = 0;
	const api = new UniversalWalletProvider([
		make('cardano', {
			enable: async () => {
				enabled++;
				return authorized;
			},
			isEnabled: async () => false,
		}),
	]);
	assert.equal(enabled, 0);
	await api.connect();
	assert.equal(enabled, 1);
	assert.equal(await api.getBalance(), 'cborValue');
	assert.equal(await api.getAddress(), 'cborChange');
	assert.equal(
		await api.signTransaction({ cbor: 'abcd', partialSign: true }),
		'witnessCBOR',
	);
	assert.deepEqual(calls, [['abcd', true]]);
	assert.deepEqual(
		await api.signData({ address: 'cborAddress', payload: 'abcd' }),
		['cborAddress', 'abcd'],
	);
	assert.equal(await api.sendRawTransaction('abcd'), 'abcd');
	api.dispose();
});

test('multiple wallets require selection; explicit chain overrides never change active connection', async () => {
	const one = make(
		'core',
		{ connect: async () => [], getAccounts: async () => ['one'] },
		{ id: 'one' },
	);
	const two = make(
		'core',
		{ connect: async () => [], getAccounts: async () => ['two'] },
		{ id: 'two' },
	);
	const btc = make('bitcoin', {
		connect: async () => [],
		getAccounts: async () => ['btc'],
	});
	const api = new UniversalWalletProvider([one, two, btc]);
	await assert.rejects(
		api.connect({ blockchain: 'core' }),
		ProviderNotFoundError,
	);
	api.selectProvider('core', 'two');
	await api.connect({ blockchain: 'core' });
	assert.deepEqual(await api.getAccounts(), ['two']);
	await api.connect({ blockchain: 'bitcoin' });
	assert.equal(api.getConnectedBlockchain(), 'core');
	assert.deepEqual(await api.getAccounts({ blockchain: 'bitcoin' }), ['btc']);
	assert.equal(api.getConnectedProvider(), two);
	await api.switchBlockchain('bitcoin');
	assert.equal(api.getConnectedBlockchain(), 'bitcoin');
	assert.throws(
		() => api.selectProvider('core', 'missing'),
		ProviderNotFoundError,
	);
	api.dispose();
});

test('rejections retain provider codes; pending and explicit IDs prevent duplicate submissions', async () => {
	const rejection = Object.assign(new Error('rejected'), { code: 4001 });
	const adapter = make('bitcoin', {
		connect: async () => [],
		signMessage: async () => {
			throw rejection;
		},
		sendTransaction: async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return 'txid';
		},
	});
	const api = new UniversalWalletProvider([adapter]);
	await api.connect();
	await assert.rejects(
		api.signMessage('test'),
		(error) =>
			error instanceof UserRejectedRequestError &&
			error.providerCode === 4001 &&
			error.cause === rejection,
	);
	const first = api.sendTransaction({ outputs: [{ value: 1 }] });
	await assert.rejects(
		api.sendTransaction({ outputs: [{ value: 1 }] }),
		InvalidTransactionError,
	);
	await first;
	await api.sendTransaction({ outputs: [] }, { requestId: 'once' });
	await assert.rejects(
		api.sendTransaction({ outputs: [] }, { requestId: 'once' }),
		InvalidTransactionError,
	);
	api.dispose();
});

test('provider events update connection and detach cleanly', async () => {
	const listeners = new Map();
	const native = {
		connect: async () => [],
		getAccounts: async () => [],
		on: (event, fn) => listeners.set(event, fn),
		removeListener: (event) => listeners.delete(event),
	};
	const api = new UniversalWalletProvider([make('core', native)]);
	const events = [];
	api.on('networkChanged', (e) => events.push(e));
	await api.connect();
	listeners.get('chainChanged')('3');
	assert.equal(events.length, 1);
	listeners.get('accountsChanged')([]);
	assert.equal(api.getConnectedProvider(), undefined);
	assert.equal(api.isConnected(), false);
	api.dispose();
	assert.equal(listeners.size, 0);
});

test('EIP/CIP discovery deduplicates wallets and supports Cardano wallet entries without prompts', async () => {
	const target = new EventTarget();
	let connects = 0;
	const native = {
		request: async () => {
			connects++;
			return [];
		},
	};
	const info = createProviderInfo({}, 'ethereum');
	const listener = () =>
		target.dispatchEvent(
			new CustomEvent('eip6963:announceProvider', {
				detail: { info, provider: native },
			}),
		);
	target.addEventListener('eip6963:requestProvider', listener);
	target.ethereum = native;
	target.cardano = {
		one: {
			enable: async () => {
				connects++;
				return {};
			},
		},
		two: {
			enable: async () => {
				connects++;
				return {};
			},
		},
	};
	target.solana = {}; // namespace existence is insufficient
	const installation = installWalletProvider({
		target,
		standardWallets: false,
	});
	assert.equal(target.connect, installation.api);
	assert.equal(installation.api.getProviders('ethereum').length, 1);
	assert.equal(installation.api.getProviders('cardano').length, 2);
	assert.equal(installation.api.getProviders('solana').length, 0);
	assert.equal(connects, 0);
	installation.refresh();
	assert.equal(installation.api.getProviders('ethereum')[0].id, info.uuid);
	installation.dispose();
	assert.equal(target.connect, undefined);
});

test('EVM optional methods are unavailable without explicit RPC capability declarations; ABI codecs work offline', async () => {
	const api = new UniversalWalletProvider([
		make('ethereum', { request: async () => [address] }),
	]);
	await assert.rejects(api.getBalance(), UnsupportedMethodError);
	const abi = [
		{
			type: 'function',
			name: 'balanceOf',
			stateMutability: 'view',
			inputs: [{ type: 'address', name: 'owner' }],
			outputs: [{ type: 'uint256' }],
		},
	];
	const encoded = await api.encodeContractCall({
		abi,
		functionName: 'balanceOf',
		args: [address],
	});
	assert.equal(encoded.slice(0, 10), '0x70a08231');
	assert.equal(
		await api.decodeContractResult({
			abi,
			functionName: 'balanceOf',
			data: '0x' + '0'.repeat(63) + '1',
		}),
		1n,
	);
	api.dispose();
});

test('Core RPC is opt-in and cannot accept Ethereum RPC; UTXO compatibility calls remain separate', async () => {
	assert.throws(
		() =>
			make(
				'core',
				{ request: async () => null },
				{ rpcMethods: ['eth_sendTransaction'] },
			),
		UnsupportedMethodError,
	);
	for (const blockchain of ['bitcoin', 'litecoin']) {
		const calls = [];
		const api = new UniversalWalletProvider([
			make(blockchain, {
				requestAccounts: async () => ['nativeAddress'],
				getAccounts: async () => ['nativeAddress'],
				getNetwork: async () => 'signet',
				getBalance: async () => ({ confirmed: 10 }),
				getUtxos: async () => ['utxo'],
				signPsbt: async (psbt) => {
					calls.push(psbt);
					return 'signed:' + psbt;
				},
				pushTx: async (raw) => 'tx:' + raw,
			}),
		]);
		await api.connect();
		assert.equal(await api.signPSBT('psbt'), 'signed:psbt');
		assert.deepEqual(await api.getUTXOs(), ['utxo']);
		assert.equal(await api.sendRawTransaction('raw'), 'tx:raw');
		assert.equal(calls.length, 1);
		assert.deepEqual(await api.getBalance({ network: 'signet' }), {
			confirmed: 10,
		});
		api.dispose();
	}
	const api = new UniversalWalletProvider([
		make(
			'core',
			{
				connect: async () => [],
				request: async ({ method, params }) => ({ method, params }),
			},
			{ rpcMethods: ['xcb_getBalance'] },
		),
	]);
	assert.deepEqual(
		await api.request({ method: 'xcb_getBalance', params: ['cbAddress'] }),
		{ method: 'xcb_getBalance', params: ['cbAddress'] },
	);
	await assert.rejects(
		api.request({ method: 'eth_chainId' }),
		UnsupportedMethodError,
	);
	api.dispose();
});

test('typed requests route native transactions and message payloads without losing types', async () => {
	const payload = { body: 'nativeCore' };
	const api = new UniversalWalletProvider([
		make('core', {
			connect: async () => [],
			getAccounts: async () => ['cbAddress'],
			signTransaction: async (tx) => tx,
			signMessage: async (message) => message,
		}),
	]);
	await api.connect();
	assert.equal(
		await api.executeTransaction('signTransaction', {
			blockchain: 'core',
			transaction: payload,
		}),
		payload,
	);
	assert.equal(
		await api.executeSigning({
			blockchain: 'core',
			message: 'hello',
			account: 'cbAddress',
		}),
		'hello',
	);
	api.dispose();
	api.dispose();
	await assert.rejects(api.connect());
});

test('Solana Wallet Standard discovers multiple providers, signs natively and forwards account changes', async () => {
	const { getWallets } = await import('@wallet-standard/app');
	let callback;
	const account = {
		address: 'solanaAddress',
		publicKey: new Uint8Array(32),
		chains: ['solana:mainnet'],
		features: ['solana:signTransaction'],
	};
	const wallet = {
		version: '1.0.0',
		name: 'Standard Test',
		icon: 'data:image/png;base64,AA==',
		chains: ['solana:mainnet'],
		accounts: [account],
		features: {
			'standard:connect': {
				version: '1.0.0',
				connect: async () => ({ accounts: [account] }),
			},
			'standard:events': {
				version: '1.0.0',
				on: (event, listener) => {
					callback = listener;
					return () => {
						callback = undefined;
					};
				},
			},
			'solana:signTransaction': {
				version: '1.0.0',
				signTransaction: async (request) => [request],
			},
		},
	};
	const unregister = getWallets().register(wallet);
	const target = new EventTarget();
	const discovery = installWalletProvider({ target });
	assert.equal(discovery.api.getProviders('solana').length, 1);
	await discovery.api.connect();
	const tx = new Uint8Array([1, 2, 3]);
	const result = await discovery.api.signTransaction(tx);
	assert.equal(result[0].transaction, tx);
	const seen = [];
	discovery.api.on('accountsChanged', (event) => seen.push(event.value));
	callback({ accounts: [] });
	assert.equal(seen.length, 1);
	assert.equal(discovery.api.getConnectedProvider(), undefined);
	unregister();
	assert.equal(discovery.api.getProviders('solana').length, 0);
	discovery.dispose();
});

test('strict event emitters and pending connection disposal do not break discovery or revive sessions', async () => {
	let release;
	const native = {
		connect: () =>
			new Promise((resolve) => {
				release = resolve;
			}),
		on: (name) => {
			if (name !== 'accountsChanged') throw new Error('Unsupported event');
		},
		removeListener: () => {
			throw new Error('Unavailable listener');
		},
	};
	const adapter = make('core', native);
	const api = new UniversalWalletProvider([adapter]);
	const connecting = api.connect();
	api.dispose();
	release([]);
	await assert.rejects(connecting);
	assert.equal(adapter.connected, false);
	assert.equal(api.getConnectedProvider(), undefined);
});

test('Monero and Zcash discovery, native calls and overrides retain separate wallet state', async () => {
	const target = new EventTarget();
	const calls = [];
	for (const blockchain of ['monero', 'zcash']) {
		target[blockchain] = {
			connect: async () => [blockchain + ':address'],
			getAccounts: async () => [blockchain + ':address'],
			getNetwork: async () => 'mainnet',
			getBalance: async () => ({ native: blockchain, balance: '123' }),
			signMessage: async (message) => ({ blockchain, message }),
			sendTransaction: async (transaction) => {
				calls.push({ blockchain, transaction });
				return blockchain + ':txid';
			},
		};
	}
	const discovery = installWalletProvider({ target, standardWallets: false });
	const api = discovery.api;
	assert.deepEqual(api.getAvailableBlockchains(), ['monero', 'zcash']);
	assert.equal(calls.length, 0);
	await api.connect({ blockchain: 'monero' });
	await api.connect({ blockchain: 'zcash' });
	assert.equal(api.getConnectedBlockchain(), 'monero');
	assert.deepEqual(await api.getAccounts(), ['monero:address']);
	assert.deepEqual(
		await api.getBalance({ blockchain: 'zcash', network: 'mainnet' }),
		{ native: 'zcash', balance: '123' },
	);
	for (const blockchain of ['monero', 'zcash']) {
		const transaction = { native: blockchain, serialized: 'unchanged' };
		assert.equal(
			await api.sendTransaction(transaction, { blockchain }),
			blockchain + ':txid',
		);
		assert.equal(calls.at(-1).transaction, transaction);
		assert.deepEqual(await api.signMessage('hello', { blockchain }), {
			blockchain,
			message: 'hello',
		});
		await assert.rejects(
			api.signPSBT('not-native', { blockchain }),
			UnsupportedMethodError,
		);
	}
	assert.equal(api.getConnectedBlockchain(), 'monero');
	discovery.dispose();
	assert.equal(target.connect, undefined);
	assert.ok(target.monero);
	assert.ok(target.zcash);
});
