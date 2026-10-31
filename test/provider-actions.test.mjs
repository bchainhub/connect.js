import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters } from 'viem';
import { sha3_256, keccak_256 } from '@noble/hashes/sha3.js';
import {
	createNativeWalletAdapter,
	UniversalWalletProvider,
	ethereumRpcMethods,
	coreRpcMethods,
	InvalidTransactionError,
	NetworkMismatchError,
	UnsupportedMethodError,
	TransactionFailedError,
} from '../dist/wallet-provider.js';
const vectors = JSON.parse(
	readFileSync(new URL('fixtures/provider-actions.json', import.meta.url)),
);
const evm = vectors.ethereumSignature.address,
	core = vectors.coreSignature.address;
function setup(blockchain, extra = {}) {
	const address = blockchain === 'core' ? core : evm,
		prefix = blockchain === 'core' ? 'xcb' : 'eth',
		calls = [];
	const provider = {
		request: async (r) => {
			calls.push(r);
			if (extra[r.method]) return extra[r.method](r.params);
			if (
				r.method.endsWith('_requestAccounts') ||
				r.method.endsWith('_accounts')
			)
				return [address];
			if (r.method === 'eth_chainId') return '0x1';
			if (r.method === 'xcb_networkId') return '1';
			if (
				r.method.endsWith('_estimateGas') ||
				r.method.endsWith('_estimateEnergy')
			)
				return '0x5208';
			if (r.method.endsWith('_gasPrice') || r.method.endsWith('_energyPrice'))
				return '0x2';
			if (r.method.endsWith('_getBalance')) return '0x7b';
			if (r.method.endsWith('_getTransactionCount')) return '0x3';
			if (r.method.endsWith('_blockNumber')) return '0xb';
			if (r.method.endsWith('_getTransactionReceipt'))
				return { status: '0x1', blockNumber: '0xa' };
			if (r.method.endsWith('_signTransaction')) return '0xsigned';
			if (r.method === 'personal_sign')
				return vectors[
					blockchain === 'core' ? 'coreSignature' : 'ethereumSignature'
				].signature;
			if (r.method.endsWith('_signTypedData_v4'))
				return vectors[
					blockchain === 'core' ? 'coreSignature' : 'ethereumSignature'
				].signature;
			if (r.method.endsWith('_getLogs')) return [];
			return '0xhash';
		},
	};
	const api = new UniversalWalletProvider([
		createNativeWalletAdapter(blockchain, provider, {
			id: blockchain,
			rpcMethods: blockchain === 'core' ? coreRpcMethods : ethereumRpcMethods,
		}),
	]);
	return { api, calls, address, prefix };
}
function normalized(p, v) {
	const a = p.type.match(/^(.*)\[([0-9]*)\]$/);
	if (a) return v.map((x) => normalized({ ...p, type: a[1] }, x));
	if (p.type === 'tuple')
		return p.components.map((x, i) =>
			normalized(x, Array.isArray(v) ? v[i] : v[x.name]),
		);
	return /^(u?int)/.test(p.type)
		? String(v)
		: typeof v === 'string' && p.type === 'address'
			? v.toLowerCase()
			: v;
}
for (const vector of vectors.cases)
	test(`independent ABI vector: ${vector.blockchain} ${vector.functionName}`, async () => {
		const { api } = setup(vector.blockchain);
		assert.equal(await api.encodeContractCall(vector), vector.encoded);
		const decoded = await api.decodeContractResult(vector);
		const values = vector.abi[0].outputs.length === 1 ? [decoded] : decoded;
		assert.deepEqual(
			values.map((v, i) => normalized(vector.abi[0].outputs[i], v)),
			vector.decoded,
		);
		api.dispose();
	});
for (const blockchain of ['ethereum', 'core'])
	test(`${blockchain}: accounts, signing, transactions, fees, deployment, receipts and networks`, async () => {
		const { api, calls, address, prefix } = setup(blockchain);
		await api.connect();
		assert.equal(await api.getChainId(), blockchain === 'core' ? '1' : '0x1');
		assert.equal(await api.getBalance(), '0x7b');
		const tx = {
			to: address,
			value: 2n,
			[blockchain === 'core' ? 'networkId' : 'chainId']: '0x1',
		};
		assert.equal(await api.signTransaction(tx), '0xsigned');
		assert.deepEqual(await api.signTransactions([tx, tx]), [
			'0xsigned',
			'0xsigned',
		]);
		assert.equal(await api.signAndSendTransaction(tx), '0xhash');
		assert.equal(calls.at(-1).method, `${prefix}_sendTransaction`);
		assert.equal(calls.at(-1).params[0].value, '0x2');
		assert.equal(calls.at(-1).params[0].from, address);
		assert.equal(await api.sendRawTransaction('0xaabb'), '0xhash');
		const prepared = await api.prepareTransaction(tx);
		assert.equal(prepared.nonce, '0x3');
		assert.equal(prepared[blockchain === 'core' ? 'energy' : 'gas'], '0x5208');
		assert.deepEqual(await api.estimateFee(tx), {
			units: '0x5208',
			price: '0x2',
			total: '0xa410',
			unit: 'native-base-units',
			isUpperBound: false,
		});
		assert.equal(
			await api.estimateTransactionFee(tx).then((r) => r.total),
			'0xa410',
		);
		assert.equal(await api.transfer({ to: address, amount: 123n }), '0xhash');
		assert.equal(calls.at(-1).params[0].value, '0x7b');
		assert.equal(
			await api.deployContract({
				bytecode: '0x6000',
				abi: [
					{ type: 'constructor', inputs: [{ name: 'n', type: 'uint256' }] },
				],
				args: [42n],
			}),
			'0xhash',
		);
		assert.equal(calls.at(-1).params[0].to, undefined);
		assert.equal(
			calls.at(-1).params[0].data,
			'0x6000' + 42n.toString(16).padStart(64, '0'),
		);
		await api.getBlock({
			hash: '0x' + '1'.repeat(64),
			includeTransactions: true,
		});
		assert.equal(calls.at(-1).method, `${prefix}_getBlockByHash`);
		await api.getBlock(10);
		assert.deepEqual(calls.at(-1).params, ['0xa', false]);
		assert.equal(
			(await api.getTransactionStatus('0xhash')).status,
			'confirmed',
		);
		assert.equal(
			(
				await api.waitForTransaction({
					hash: '0xhash',
					confirmations: 2,
					pollIntervalMs: 1,
					timeoutMs: 20,
				})
			).blockNumber,
			'0xa',
		);
		const typed = {
			domain: {
				[blockchain === 'core' ? 'networkId' : 'chainId']: 1,
				verifyingContract: address,
			},
			types: {},
			primaryType: 'Message',
			message: {},
		};
		await api.signTypedData(typed);
		assert.equal(calls.at(-1).method, `${prefix}_signTypedData_v4`);
		assert.equal(
			JSON.parse(calls.at(-1).params[1]).domain[
				blockchain === 'core' ? 'networkId' : 'chainId'
			],
			1,
		);
		assert.equal(
			await api.signMessage('hello'),
			vectors[blockchain === 'core' ? 'coreSignature' : 'ethereumSignature']
				.signature,
		);
		assert.equal(
			await api.verifyMessage(
				vectors[blockchain === 'core' ? 'coreSignature' : 'ethereumSignature'],
			),
			true,
		);
		assert.equal(
			await api.verifyMessage({
				...vectors[
					blockchain === 'core' ? 'coreSignature' : 'ethereumSignature'
				],
				message: 'tampered',
			}),
			false,
		);
		const count = calls.length;
		await assert.rejects(
			api.sendTransaction(
				{ ...tx, [blockchain === 'core' ? 'networkId' : 'chainId']: '0x2' },
				{ network: 1 },
			),
			NetworkMismatchError,
		);
		await assert.rejects(
			api.request({
				method: `${prefix}_sendTransaction`,
				params: [
					{ ...tx, [blockchain === 'core' ? 'networkId' : 'chainId']: '0x2' },
				],
				network: 1,
			}),
			NetworkMismatchError,
		);
		assert.equal(calls.length, count);
		await assert.rejects(
			api.signMessage({ not: 'message' }),
			InvalidTransactionError,
		);
		await assert.rejects(
			api.signTypedData({
				...typed,
				domain: {
					...typed.domain,
					[blockchain === 'core' ? 'networkId' : 'chainId']: 2,
				},
			}),
			NetworkMismatchError,
		);
		if (blockchain === 'core') {
			await assert.rejects(
				api.signTypedData({ ...typed, domain: { chainId: 1 } }),
				InvalidTransactionError,
			);
			await assert.rejects(
				api.sendTransaction({ to: address, gas: '0x1' }),
				InvalidTransactionError,
			);
		} else {
			await api.addNetwork({
				chainId: '0x2',
				rpcUrls: ['https://rpc.example'],
			});
			assert.equal(calls.at(-1).method, 'wallet_addEthereumChain');
			await api.switchNetwork(2);
			assert.deepEqual(calls.at(-1).params, [{ chainId: '0x2' }]);
		}
		api.dispose();
	});
for (const blockchain of ['ethereum', 'core'])
	test(`${blockchain}: token balances, allowances, transfers, NFT calls and metadata`, async () => {
		const hash = blockchain === 'core' ? sha3_256 : keccak_256;
		const selector = (text) =>
			'0x' +
			Array.from(hash(new TextEncoder().encode(text)).slice(0, 4), (b) =>
				b.toString(16).padStart(2, '0'),
			).join('');
		const response = ([tx]) =>
			tx.data.startsWith(selector('name()'))
				? encodeAbiParameters([{ type: 'string' }], ['Example Token'])
				: tx.data.startsWith(selector('symbol()'))
					? encodeAbiParameters([{ type: 'string' }], ['EXT'])
					: encodeAbiParameters(
							[{ type: 'uint256' }],
							[tx.data.startsWith(selector('decimals()')) ? 18n : 42n],
						);
		const prefix = blockchain === 'core' ? 'xcb' : 'eth';
		const { api, address, calls } = setup(blockchain, {
			[`${prefix}_call`]: response,
		});
		await api.connect();
		assert.equal(await api.getTokenBalance({ token: address }), 42n);
		assert.equal(
			await api.getTokenAllowance({ token: address, spender: address }),
			42n,
		);
		assert.deepEqual(await api.getTokenBalances({ tokens: [address] }), [
			{ token: address, balance: 42n },
		]);
		assert.deepEqual(await api.getTokenMetadata({ token: address }), {
			address,
			name: 'Example Token',
			symbol: 'EXT',
			decimals: 18,
		});
		for (const [method, input, signature] of [
			[
				'approveToken',
				{ token: address, spender: address, amount: 10n },
				'approve(address,uint256)',
			],
			[
				'transferToken',
				{ token: address, to: address, amount: 5n },
				'transfer(address,uint256)',
			],
			[
				'transferNFT',
				{ token: address, to: address, tokenId: 7n },
				'safeTransferFrom(address,address,uint256)',
			],
			[
				'transferNFT',
				{
					token: address,
					to: address,
					tokenId: 7n,
					amount: 2n,
					standard: 'erc1155',
				},
				'safeTransferFrom(address,address,uint256,uint256,bytes)',
			],
		]) {
			await api.execute(method, input);
			assert.ok(calls.at(-1).params[0].data.startsWith(selector(signature)));
		}
		assert.deepEqual(await api.getBalances({ addresses: [address] }), [
			{ address, balance: '0x7b' },
		]);
		const other =
			blockchain === 'core'
				? vectors.coreSignature.address
				: '0x' + 'b'.repeat(40);
		assert.equal(await api.getBalance({ address: other }), '0x7b');
		api.dispose();
	});
test('Core native networkId objects normalize correctly; RPC defaults enable real request-only providers', async () => {
	const api = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'core',
			{
				connect: async () => [core],
				getNetwork: async () => ({ networkId: 1 }),
				getBalance: async () => '123',
			},
			{ id: 'sdk' },
		),
	]);
	await api.connect();
	assert.equal(await api.getBalance({ network: 1 }), '123');
	api.dispose();
	const rpc = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'core',
			{ request: async (r) => (r.method === 'xcb_networkId' ? '1' : [core]) },
			{ id: 'rpc' },
		),
	]);
	await rpc.connect({ network: 1 });
	assert.deepEqual(await rpc.getAccounts(), [core]);
	rpc.dispose();
});
test('waiting observes receipts, reports reversion, times out and stops when disposed', async () => {
	let count = 0;
	const pending = setup('ethereum', {
		eth_getTransactionReceipt: () =>
			++count < 2 ? null : { status: '0x1', blockNumber: '0xa' },
	});
	assert.equal(
		(
			await pending.api.waitForTransaction({
				hash: 'x',
				pollIntervalMs: 1,
				timeoutMs: 100,
			})
		).status,
		'0x1',
	);
	pending.api.dispose();
	const reverted = setup('ethereum', {
		eth_getTransactionReceipt: () => ({ status: '0x0' }),
	});
	await assert.rejects(
		reverted.api.waitForTransaction('x'),
		TransactionFailedError,
	);
	reverted.api.dispose();
	const timed = setup('ethereum', { eth_getTransactionReceipt: () => null });
	await assert.rejects(
		timed.api.waitForTransaction({
			hash: 'x',
			timeoutMs: 5,
			pollIntervalMs: 1,
		}),
		TransactionFailedError,
	);
	timed.api.dispose();
	const disposed = setup('ethereum', { eth_getTransactionReceipt: () => null });
	const waiting = disposed.api.waitForTransaction({
		hash: 'x',
		timeoutMs: 100,
		pollIntervalMs: 1,
	});
	disposed.api.dispose();
	await assert.rejects(waiting);
});
test('other chain adapters preserve native methods and multi-argument compatibility shapes', async () => {
	for (const blockchain of ['bitcoin', 'litecoin']) {
		const calls = [];
		const send = blockchain === 'bitcoin' ? 'sendBitcoin' : 'sendLitecoin';
		const native = {
			requestAccounts: async () => ['address'],
			getAccounts: async () => ['address'],
			getChain: async () => ({ enum: 'signet' }),
			switchChain: async (name) => calls.push(name),
			signPsbt: async (...args) => args,
			signPsbts: async (...args) => args,
			signMessage: async (...args) => args,
			[send]: async (...args) => args,
		};
		const api = new UniversalWalletProvider([
			createNativeWalletAdapter(blockchain, native, { id: blockchain }),
		]);
		await api.connect();
		assert.deepEqual(
			await api.signPSBT({ psbt: 'native', options: { autoFinalized: false } }),
			['native', { autoFinalized: false }],
		);
		assert.deepEqual(
			await api.signPSBTs({ psbts: ['one', 'two'], options: [{}] }),
			[['one', 'two'], [{}]],
		);
		assert.deepEqual(
			await api.signMessage({ message: 'hello', type: 'bip322-simple' }),
			['hello', 'bip322-simple'],
		);
		assert.deepEqual(
			await api.transfer({
				to: 'address',
				amount: 123,
				options: { feeRate: 2 },
			}),
			['address', 123, { feeRate: 2 }],
		);
		await api.switchNetwork('signet');
		assert.equal(calls.at(-1), 'signet');
		api.dispose();
	}
	const monero = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'monero',
			{
				connect: async () => [],
				getPrimaryAddress: async () => 'monero',
				getPublicSpendKey: async () => 'public',
				getNetworkType: async () => 0,
				relayTx: async (data) => data,
				signMessage: async (...args) => args,
			},
			{ id: 'monero' },
		),
	]);
	await monero.connect();
	assert.equal(await monero.getAddress(), 'monero');
	assert.equal(await monero.getPublicKey(), 'public');
	assert.equal(await monero.sendRawTransaction('metadata'), 'metadata');
	assert.deepEqual(
		await monero.signMessage({ message: 'hello', accountIndex: 2 }),
		['hello', undefined, 2, undefined],
	);
	monero.dispose();
	const aptos = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'aptos',
			{
				connect: async () => [],
				account: async () => ({ address: 'aptos', publicKey: 'public' }),
				network: async () => ({ name: 'testnet', chainId: 2 }),
				signAndSubmitTransaction: async (tx) => tx,
				changeNetwork: async (input) => input,
			},
			{ id: 'aptos' },
		),
	]);
	await aptos.connect();
	assert.equal(await aptos.getPublicKey(), 'public');
	assert.deepEqual(
		await aptos.sendTransaction({ native: true }, { network: 'testnet' }),
		{ native: true },
	);
	aptos.dispose();
	const near = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'near',
			{
				signIn: async () => [],
				getAccounts: async () => ['near'],
				signAndSendTransaction: async (tx) => tx,
			},
			{ id: 'near' },
		),
	]);
	await near.connect();
	assert.deepEqual(
		await near.sendTransaction({ receiverId: 'contract', actions: [] }),
		{ receiverId: 'contract', actions: [] },
	);
	await assert.rejects(near.signTransactions([{}]), UnsupportedMethodError);
	near.dispose();
	const zcash = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'zcash',
			{ connect: async () => [], signTransaction: async (tx) => tx },
			{ id: 'zcash' },
		),
	]);
	await zcash.connect();
	const shielded = { shielded: 'native' };
	assert.equal((await zcash.signTransactions([shielded]))[0], shielded);
	await assert.rejects(zcash.signPSBT('bitcoin'), UnsupportedMethodError);
	zcash.dispose();
});

test('TON SDK links stay pending until wallet authorization; later status events activate only requested connections', async () => {
	let listener;
	const native = {
		account: null,
		connect: async () => 'ton://connect?request=example',
		sendTransaction: async (request) => request,
		onStatusChange: (callback) => {
			listener = callback;
			return () => {
				listener = undefined;
			};
		},
		disconnect: async () => {
			native.account = null;
		},
	};
	const api = new UniversalWalletProvider([
		createNativeWalletAdapter('ton', native, { id: 'ton' }),
	]);
	assert.equal(
		await api.connect({ network: '-239' }),
		'ton://connect?request=example',
	);
	assert.equal(api.getConnectedProvider(), undefined);
	assert.equal(api.isConnected(), false);
	await assert.rejects(api.sendTransaction({ messages: [] }));
	native.account = { address: 'tonAddress', chain: '-239' };
	listener({ account: native.account });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(api.getConnectedBlockchain(), 'ton');
	assert.deepEqual(await api.sendTransaction({ messages: [] }), {
		messages: [],
	});
	await api.disconnect();
	assert.equal(api.getConnectedProvider(), undefined);
	api.dispose();
	assert.equal(listener, undefined);
});
test('Core ABI supports CIP-100 system addresses without treating them as signing accounts', async () => {
	const { api } = setup('core');
	const abi = [
		{
			type: 'function',
			name: 'system',
			inputs: [{ type: 'address' }],
			outputs: [{ type: 'address' }],
		},
	];
	const zero = '0'.repeat(44);
	const encoded = await api.encodeContractCall({
		abi,
		functionName: 'system',
		args: [zero],
	});
	assert.equal(encoded.slice(10), '0'.repeat(64));
	assert.equal(
		await api.decodeContractResult({
			abi,
			functionName: 'system',
			data: '0x' + '0'.repeat(64),
		}),
		zero,
	);
	api.dispose();
});

test('broadcast deduplication spans aliases, key order, native requests and provider-wide request IDs', async () => {
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const { api } = setup('ethereum', { eth_sendTransaction: () => pending });
	await api.connect();
	const first = api.sendTransaction({ to: evm, value: '0x1' });
	await assert.rejects(
		api.signAndSendTransaction({ value: '0x1', to: evm }),
		InvalidTransactionError,
	);
	release('0xhash');
	await first;
	await api.sendTransaction({ to: evm, value: '0x2' }, { requestId: 'once' });
	await assert.rejects(
		api.request({
			method: 'eth_sendTransaction',
			params: [{ to: evm, value: '0x2' }],
			requestId: 'once',
		}),
		InvalidTransactionError,
	);
	api.dispose();
});

test('Solana Wallet Standard binds explicit networks, byte messages and bulk signing without active-network RPC', async () => {
	const { getWallets } = await import('@wallet-standard/app');
	const { installWalletProvider } = await import('../dist/wallet-provider.js');
	const chains = ['solana:mainnet', 'solana:devnet'];
	const account = {
		address: 'solanaAddress',
		publicKey: new Uint8Array(32),
		chains,
		features: ['solana:signTransaction', 'solana:signMessage'],
	};
	let received = [];
	const wallet = {
		version: '1.0.0',
		name: 'Per-request Solana',
		icon: 'data:image/png;base64,AA==',
		chains,
		accounts: [account],
		features: {
			'standard:connect': {
				version: '1.0.0',
				connect: async () => ({ accounts: [account] }),
			},
			'solana:signTransaction': {
				version: '1.0.0',
				signTransaction: async (...args) => {
					received = args;
					return args;
				},
			},
			'solana:signMessage': {
				version: '1.0.0',
				signMessage: async (...args) => {
					received = args;
					return args;
				},
			},
		},
	};
	const unregister = getWallets().register(wallet);
	const discovery = installWalletProvider({ target: new EventTarget() });
	const api = discovery.api;
	await api.connect();
	await assert.rejects(
		api.signTransaction(new Uint8Array([1])),
		/Choose a network/,
	);
	const transactions = [new Uint8Array([1]), new Uint8Array([2])];
	const result = await api.signTransactions(transactions, {
		network: 'solana:devnet',
		nativeOptions: { commitment: 'confirmed' },
	});
	assert.equal(result.length, 2);
	assert.equal(received[0].chain, 'solana:devnet');
	assert.equal(received[1].transaction, transactions[1]);
	await api.signMessage('hello', { network: 'devnet' });
	assert.deepEqual(received[0].message, new TextEncoder().encode('hello'));
	await assert.rejects(
		api.signTransaction(new Uint8Array([1]), { network: 'not-supported' }),
	);
	discovery.dispose();
	unregister();
});
test('Cardano bulk signing produces native witnesses and never silently submits them', async () => {
	let submissions = 0;
	const api = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'cardano',
			{
				enable: async () => ({
					getUsedAddresses: async () => ['abcd'],
					getBalance: async () => 'cbor',
					signTx: async (cbor) => 'witness:' + cbor,
					submitTx: async () => {
						submissions++;
						return 'txid';
					},
					getCollateral: async () => ['cborUtxo'],
				}),
			},
			{ id: 'cardano' },
		),
	]);
	await api.connect();
	assert.deepEqual(await api.signTransactions(['abcd', 'aabb']), [
		'witness:abcd',
		'witness:aabb',
	]);
	assert.equal(submissions, 0);
	assert.deepEqual(await api.request({ method: 'getCollateral' }), [
		'cborUtxo',
	]);
	await assert.rejects(api.sendTransaction('abcd'), UnsupportedMethodError);
	api.dispose();
});

test('EIP-1559 fee bounds preserve caller caps and reject invalid mixed fee models', async () => {
	const { api } = setup('ethereum');
	await api.connect();
	const tx = { to: evm, maxFeePerGas: '0x5', maxPriorityFeePerGas: '0x2' };
	const fee = await api.estimateFee(tx);
	assert.equal(fee.isUpperBound, true);
	assert.equal(fee.total, '0x19a28');
	const prepared = await api.prepareTransaction(tx);
	assert.equal(prepared.maxFeePerGas, '0x5');
	assert.equal(prepared.gasPrice, undefined);
	await assert.rejects(
		api.sendTransaction({ ...tx, gasPrice: '0x1' }),
		InvalidTransactionError,
	);
	await assert.rejects(
		api.sendTransaction({ ...tx, maxPriorityFeePerGas: '0x6' }),
		InvalidTransactionError,
	);
	api.dispose();
});

test('resource-limit aliases, prefixed Core accounts and direct Ethereum SDK signing remain compatible', async () => {
	const { api, calls } = setup('core', {
		xcb_accounts: () => ['0x' + core.toUpperCase()],
		xcb_requestAccounts: () => ['0x' + core.toUpperCase()],
	});
	await api.connect();
	await api.signTransaction(
		{ to: '0x' + core, from: '0x' + core, energyLimit: 30000n, type: 0 },
		{ account: core },
	);
	const tx = calls.at(-1).params[0];
	assert.equal(tx.energy, '0x7530');
	assert.equal(tx.energyLimit, undefined);
	assert.equal(tx.type, '0x0');
	assert.equal(tx.from, core);
	assert.equal(
		await api.verifyMessage({
			...vectors.coreSignature,
			address: '0x' + core.toUpperCase(),
		}),
		true,
	);
	await assert.rejects(
		api.signTransaction({ to: core, energy: '0x1', energyLimit: 2 }),
		InvalidTransactionError,
	);
	api.dispose();
	const ethereum = setup('ethereum');
	await ethereum.api.connect();
	await ethereum.api.signTransaction({ to: evm, gasLimit: 21000n, type: 2 });
	assert.equal(ethereum.calls.at(-1).params[0].gas, '0x5208');
	assert.equal(ethereum.calls.at(-1).params[0].type, '0x2');
	ethereum.api.dispose();
	const sdk = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'ethereum',
			{
				connect: async () => [evm],
				getAccounts: async () => [evm],
				signTransaction: async (tx) => tx,
			},
			{ id: 'sdk' },
		),
	]);
	await sdk.connect();
	const native = { to: evm, value: 2n };
	assert.equal(await sdk.signTransaction(native), native);
	assert.deepEqual(await sdk.signTransactions([native, native]), [
		native,
		native,
	]);
	sdk.dispose();
});

test('Core transaction and typed-domain ICAN prefixes must match explicit network context', async () => {
	const body = core.slice(4),
		decimal = [...(body + 'ab00')]
			.map((c) => parseInt(c, 16).toString())
			.join('');
	const devin =
		'ab' + (98n - (BigInt(decimal) % 97n)).toString().padStart(2, '0') + body;
	const { api, calls } = setup('core');
	await api.connect();
	await assert.rejects(
		api.sendTransaction({ to: devin, networkId: 1 }),
		NetworkMismatchError,
	);
	await assert.rejects(
		api.signTypedData({
			domain: { networkId: 1, verifyingContract: devin },
			types: {},
			message: {},
		}),
		NetworkMismatchError,
	);
	assert.equal(
		calls.some(
			(r) =>
				r.method === 'xcb_sendTransaction' ||
				r.method === 'xcb_signTypedData_v4',
		),
		false,
	);
	api.dispose();
});
test('disposal during native SDK batch signing prevents subsequent signing requests', async () => {
	let release, started;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const active = new Promise((resolve) => {
		started = resolve;
	});
	let signed = 0;
	const api = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'core',
			{
				connect: async () => [core],
				getAccounts: async () => [core],
				signTransaction: async (tx) => {
					signed++;
					started();
					await pending;
					return tx;
				},
			},
			{ id: 'sdk' },
		),
	]);
	await api.connect();
	const batch = api.signTransactions([{ to: core }, { to: core }]);
	await active;
	api.dispose();
	release();
	await assert.rejects(batch);
	assert.equal(signed, 1);
});

for (const blockchain of ['core', 'ethereum']) {
	test(`${blockchain}: bytecode and storage use CoreBC-compatible RPC parameters`, async () => {
		const { api, calls, address, prefix } = setup(blockchain, {
			[`${blockchain === 'core' ? 'xcb' : 'eth'}_getCode`]: () => '0x6000',
			[`${blockchain === 'core' ? 'xcb' : 'eth'}_getStorageAt`]: () => '0x01',
		});
		assert.equal(
			await api.getCode({ address }, { blockTag: 'pending' }),
			'0x6000',
		);
		assert.equal(await api.getStorage({ address, position: 15n }), '0x01');
		assert.deepEqual(
			calls.filter((r) => r.method === `${prefix}_getCode`).at(-1).params,
			[address, 'pending'],
		);
		assert.deepEqual(
			calls.filter((r) => r.method === `${prefix}_getStorageAt`).at(-1).params,
			[address, '0xf', 'latest'],
		);
		const before = calls.length;
		await assert.rejects(
			api.getStorage({ address, position: 1n << 256n }),
			InvalidTransactionError,
		);
		await assert.rejects(
			api.getStorage({ address, position: -1 }),
			InvalidTransactionError,
		);
		assert.equal(calls.length, before);
		await api.dispose();
	});
}
test('CoreBC native bytecode/storage methods receive positional arguments', async () => {
	const calls = [];
	const api = new UniversalWalletProvider([
		createNativeWalletAdapter(
			'core',
			{
				getCode: async (...args) => {
					calls.push(args);
					return '0x6000';
				},
				getStorage: async (...args) => {
					calls.push(args);
					return '0x01';
				},
			},
			{ id: 'corebc' },
		),
	]);
	assert.equal(await api.getCode(core, { blockTag: 'pending' }), '0x6000');
	assert.equal(await api.getStorage({ address: core, position: 15 }), '0x01');
	assert.deepEqual(calls, [
		[core, 'pending'],
		[core, 15n, 'latest'],
	]);
	await api.dispose();
});

test('Core private network IDs start at 10; zero and reserved IDs are rejected', async () => {
	const body = core.slice(4),
		decimal = [...`${body}ce00`]
			.map((c) => parseInt(c, 16).toString())
			.join('');
	const address = `ce${(98n - (BigInt(decimal) % 97n)).toString().padStart(2, '0')}${body}`;
	let network = 10,
		signed = 0;
	const { api } = setup('core', {
		xcb_requestAccounts: () => [address],
		xcb_accounts: () => [address],
		xcb_networkId: () => String(network),
		xcb_signTransaction: () => {
			signed++;
			return '0xsigned';
		},
	});
	await api.connect();
	for (network of [10, 11, 100])
		assert.equal(
			await api.signTransaction(
				{ to: address, networkId: network },
				{ network },
			),
			'0xsigned',
		);
	assert.equal(signed, 3);
	for (network of [0, 2, 5, 9])
		await assert.rejects(
			api.signTransaction({ to: address, networkId: network }, { network }),
			InvalidTransactionError,
		);
	assert.equal(signed, 3);
	const { validateAddress } = await import('../dist/provider/chain-utils.js');
	const system = '0'.repeat(44);
	assert.equal(validateAddress(system, 'core', 10), system);
	assert.throws(
		() => validateAddress(system, 'core', 0),
		InvalidTransactionError,
	);
	await api.dispose();
});
