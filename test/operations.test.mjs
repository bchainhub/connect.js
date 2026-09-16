import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import {
	OperationDispatcher,
	OperationError,
	operationMethods,
	operationErrorMessages,
	parseOperation,
	serializeOperation,
	parseOperationResponse,
	serializeOperationResponse,
	parseCapabilities,
	supportsOperation,
	createOperation,
	operationAccounts,
	requestOperation,
} from '../dist/operations.js';
import { OperationCipher } from '../dist/operation-channel.js';
const fixture = JSON.parse(
	await readFile(
		new URL('./fixtures/operations/conformance.json', import.meta.url),
	),
);
const origin = 'https://example.com';
const base = fixture.requests[0].request;
const clone = (v) => JSON.parse(JSON.stringify(v));
const request = (changes = {}) => ({ ...clone(base), ...changes });
function setup(options = {}) {
	let approved = 0,
		executed = 0,
		validated = 0;
	const provider = {
		getAccounts: async () => [
			{
				account: base.account,
				sign: () => {
					throw Error('authentication signer must not run');
				},
			},
		],
	};
	const methods = [...Object.values(operationMethods), 'myapp.customOperation'];
	const adapter = {
		capabilities: [{ ...base.chain, methods }],
		validateAccount: (a) => a.address === base.account.address,
		validateOperation: (r) => {
			validated++;
			if (r.params.invalid) throw new OperationError('INVALID_TRANSACTION');
		},
		handlers: Object.fromEntries(
			methods.map((m) => [
				m,
				() => {
					executed++;
					return { ok: true };
				},
			]),
		),
		...options.adapter,
	};
	const dispatcher = new OperationDispatcher({
		adapters: [adapter],
		accounts: provider,
		approve: () => {
			approved++;
			return true;
		},
		...options.dispatcher,
	});
	return {
		dispatcher,
		provider,
		adapter,
		counts: () => ({ approved, executed, validated }),
	};
}
for (const f of fixture.requests)
	test(`shared operation fixture: ${f.name}`, () => {
		assert.deepEqual(
			JSON.parse(serializeOperation(parseOperation(f.request))),
			f.request,
		);
	});
test('response, capability and request ID parity', () => {
	for (const r of fixture.responses)
		assert.deepEqual(
			JSON.parse(
				serializeOperationResponse(parseOperationResponse(r, r.requestId)),
			),
			r,
		);
	assert.deepEqual(
		parseCapabilities(fixture.capabilities),
		fixture.capabilities,
	);
	assert.equal(
		supportsOperation(fixture.capabilities, base.chain, 'wallet.signPsbt'),
		true,
	);
	assert.equal(
		supportsOperation(
			fixture.capabilities,
			{ ...base.chain, reference: 'unknown' },
			'wallet.signPsbt',
		),
		false,
	);
	assert.throws(
		() => parseOperationResponse(fixture.responses[0], 'f'.repeat(64)),
		OperationError,
	);
	assert.throws(
		() => parseCapabilities([...fixture.capabilities, ...fixture.capabilities]),
		OperationError,
	);
	assert.throws(
		() => parseCapabilities([{ ...base.chain, methods: ['wallet.invented'] }]),
		OperationError,
	);
	assert.match(
		createOperation({
			operation: 'chain.getBalance',
			chain: base.chain,
			params: {},
		}).requestId,
		/^[a-f0-9]{64}$/,
	);
});
for (const method of [
	...Object.values(operationMethods),
	'myapp.customOperation',
])
	test(`dispatch ${method} with approval policy`, async () => {
		const s = setup();
		const r = await s.dispatcher.dispatch(
			request({ operation: method }),
			origin,
		);
		assert.deepEqual(r, {
			version: 1,
			requestId: base.requestId,
			result: { ok: true },
		});
		assert.equal(s.counts().approved, method.startsWith('chain.') ? 0 : 1);
		assert.equal(s.counts().executed, 1);
		assert.equal(
			(await s.dispatcher.dispatch(request({ operation: method }), origin))
				.error.code,
			'UNAUTHORIZED',
		);
	});
test('multiple namespaces, chain references, accounts and explicit capabilities', async () => {
	const accounts = fixture.requests
		.slice(0, 16)
		.map((f) => ({ account: f.request.account }));
	const caps = new Map();
	for (const f of fixture.requests.slice(0, 16)) {
		const key = JSON.stringify(f.request.chain);
		const current = caps.get(key) ?? { ...f.request.chain, methods: [] };
		if (!current.methods.includes(f.request.operation))
			current.methods.push(f.request.operation);
		caps.set(key, current);
	}
	const handlers = Object.fromEntries(
		Object.values(operationMethods).map((m) => [m, (r) => r.account.address]),
	);
	const d = new OperationDispatcher({
		adapters: [
			{
				capabilities: [...caps.values()],
				handlers,
				validateAccount: () => true,
				validateOperation: () => {},
			},
		],
		accounts: { getAccounts: async () => accounts },
		approve: () => true,
	});
	for (const f of fixture.requests.slice(0, 16))
		assert.equal(
			(await d.dispatch(f.request, origin)).result,
			f.request.account.address,
		);
	assert.equal(d.supports(base.chain, 'wallet.signTypedData'), false);
});
for (const [name, change, code] of [
	[
		'unknown chain',
		{ chain: { namespace: 'unknown', reference: '1' }, account: undefined },
		'UNSUPPORTED_CHAIN',
	],
	[
		'unknown operation',
		{ operation: 'wallet.unknown' },
		'UNSUPPORTED_OPERATION',
	],
	[
		'custom unregistered',
		{ operation: 'myapp.unknown' },
		'UNSUPPORTED_OPERATION',
	],
	['missing account', { account: undefined }, 'UNSUPPORTED_ACCOUNT'],
	[
		'wrong account',
		{ account: { ...base.account, address: 'bad' } },
		'UNSUPPORTED_ACCOUNT',
	],
	[
		'mismatched account',
		{ account: { ...base.account, reference: '2' } },
		'UNSUPPORTED_ACCOUNT',
	],
	['invalid transaction', { params: { invalid: true } }, 'INVALID_TRANSACTION'],
])
	test(name, async () => {
		const s = setup();
		const value = request(change);
		if (value.account === undefined) delete value.account;
		assert.equal((await s.dispatcher.dispatch(value, origin)).error.code, code);
		assert.equal(s.counts().executed, 0);
		assert.equal(s.counts().approved, 0);
	});
test('malformed inputs and reserved names fail safely without payload echo', async () => {
	const malformed = [
		null,
		[],
		'{',
		request({ version: 2 }),
		request({ requestId: 'bad' }),
		request({ params: [] }),
		request({ params: { private_key: 'secret' } }),
		request({ extra: true }),
		request({ operation: 'wallet.signMessage\n' }),
		request({ params: { value: Infinity } }),
		request({ params: { value: 9007199254740992 } }),
		request({ params: { value: 'x'.repeat(17000) } }),
	];
	let deep = {};
	for (let i = 0; i < 35; i++) deep = { next: deep };
	malformed.push(request({ params: deep }));
	malformed.push(
		JSON.stringify(request()).replace(
			'"params":{',
			'"params":{"__proto__":{},',
		),
	);
	for (const value of malformed) {
		assert.throws(() => parseOperation(value), OperationError);
		const r = await setup().dispatcher.dispatch(value, origin);
		assert.equal(r.error.code, 'INVALID_PARAMS');
		assert.ok(!JSON.stringify(r).includes('secret'));
	}
	assert.equal(
		(await setup().dispatcher.dispatch('{', origin)).requestId,
		null,
	);
	assert.equal(
		(await setup().dispatcher.dispatch(request({ version: 2 }), origin))
			.requestId,
		base.requestId,
	);
	assert.throws(
		() =>
			parseOperationResponse({
				...fixture.responses[0],
				error: { code: 'TIMEOUT', message: 'Timeout' },
			}),
		OperationError,
	);
});
test('immutable validated snapshot survives caller mutation during approval', async () => {
	let finish;
	const gate = new Promise((resolve) => {
		finish = resolve;
	});
	const value = request();
	let observed;
	const s = setup({
		dispatcher: {
			approve: async (r) => {
				observed = r;
				await gate;
				return true;
			},
		},
	});
	const pending = s.dispatcher.dispatch(value, origin);
	await new Promise((resolve) => setTimeout(resolve, 0));
	value.params.transaction.value = '999';
	assert.ok(Object.isFrozen(observed.params.transaction));
	assert.notEqual(observed.params.transaction.value, '999');
	finish();
	assert.ok((await pending).result);
});
test('approval absence, rejection, errors and revoked accounts never sign', async () => {
	for (const [approve, code] of [
		[undefined, 'UNAUTHORIZED'],
		[() => false, 'USER_REJECTED'],
		[
			() => {
				throw Error('private secret');
			},
			'UNAUTHORIZED',
		],
	]) {
		const s = setup({ dispatcher: { approve } });
		const r = await s.dispatcher.dispatch(request(), origin);
		assert.equal(r.error.code, code);
		assert.equal(s.counts().executed, 0);
		assert.ok(!JSON.stringify(r).includes('private'));
	}
	let available = true;
	const s = setup({
		dispatcher: {
			accounts: {
				getAccounts: async () => (available ? [{ account: base.account }] : []),
			},
			approve: () => {
				available = false;
				return true;
			},
		},
	});
	assert.equal(
		(await s.dispatcher.dispatch(request(), origin)).error.code,
		'UNSUPPORTED_ACCOUNT',
	);
	assert.equal(s.counts().executed, 0);
	assert.equal(
		(await setup().dispatcher.dispatch(request(), 'http://example.com')).error
			.code,
		'UNAUTHORIZED',
	);
});
for (const [method, code] of [
	['wallet.signTransaction', 'SIGNING_FAILED'],
	['wallet.sendTransaction', 'BROADCAST_FAILED'],
	['chain.call', 'CHAIN_UNAVAILABLE'],
])
	test(`safe ${code}`, async () => {
		const s = setup({
			adapter: {
				handlers: {
					...setup().adapter.handlers,
					[method]: () => {
						throw Error('secret-internal-material');
					},
				},
			},
		});
		const r = await s.dispatcher.dispatch(
			request({ operation: method }),
			origin,
		);
		assert.equal(r.error.code, code);
		assert.equal(r.error.message, operationErrorMessages[code]);
		assert.ok(!JSON.stringify(r).includes('secret'));
	});
test('explicit errors, translation, normalization and message preparation', async () => {
	for (const code of Object.keys(operationErrorMessages)) {
		const s = setup({
			adapter: {
				validateOperation: () => {
					throw new OperationError(code);
				},
			},
		});
		assert.equal(
			(await s.dispatcher.dispatch(request(), origin)).error.code,
			code,
		);
	}
	const translated = setup({
		adapter: {
			validateOperation: () => {
				throw Error('opaque');
			},
			translateError: () => 'CHAIN_UNAVAILABLE',
		},
	});
	assert.equal(
		(await translated.dispatcher.dispatch(request(), origin)).error.code,
		'CHAIN_UNAVAILABLE',
	);
	let prepared;
	const s = setup({
		adapter: {
			prepareMessage: () => ({ bytes: '0102' }),
			normalizeResult: () => 'normalized',
		},
		dispatcher: {
			approve: (_r, _c, p) => {
				prepared = p;
				return true;
			},
		},
	});
	assert.equal(
		(
			await s.dispatcher.dispatch(
				request({ operation: 'wallet.signMessage' }),
				origin,
			)
		).result,
		'normalized',
	);
	assert.deepEqual(prepared, { bytes: '0102' });
});
test('timeout cancels delayed approval and preserves replay protection', async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const s = setup({ dispatcher: { timeoutMs: 5, approve: () => gate } });
	assert.equal(
		(await s.dispatcher.dispatch(request(), origin)).error.code,
		'TIMEOUT',
	);
	release(true);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(s.counts().executed, 0);
	assert.equal(
		(await s.dispatcher.dispatch(request(), origin)).error.code,
		'UNAUTHORIZED',
	);
});
test('transport correlation, account provider bridge and bounded session', async () => {
	const s = setup();
	assert.deepEqual(
		await operationAccounts(s.provider, base.chain)(parseOperation(base), {}),
		[base.account],
	);
	assert.ok(
		(
			await requestOperation(
				{ exchange: (input) => s.dispatcher.dispatchJson(input, origin) },
				base,
			)
		).result,
	);
	await assert.rejects(
		requestOperation(
			{
				exchange: async () =>
					JSON.stringify({
						...fixture.responses[0],
						requestId: 'f'.repeat(64),
					}),
			},
			base,
		),
		OperationError,
	);
	const bounded = setup({ dispatcher: { maxRequests: 1 } }).dispatcher;
	await bounded.dispatch(base, origin);
	assert.equal(
		(await bounded.dispatch(request({ requestId: 'f'.repeat(64) }), origin))
			.error.code,
		'UNAUTHORIZED',
	);
});
test('shared encryption fixture, tamper rejection and both directions', async () => {
	const f = fixture.encrypted;
	const key = Uint8Array.from(Buffer.from(f.pairingKeyHex, 'hex'));
	const cipher = new OperationCipher(f.origin, f.request.requestId, key);
	assert.deepEqual(
		await cipher.openRequest(JSON.stringify(f.packet)),
		f.request,
	);
	assert.deepEqual(
		await cipher.openRequest(await cipher.sealRequest(f.request)),
		f.request,
	);
	const response = fixture.responses[0];
	const packet = await cipher.sealResponse(response);
	assert.deepEqual(await cipher.openResponse(packet), response);
	await assert.rejects(cipher.openRequest(packet), OperationError);
	await assert.rejects(
		new OperationCipher(
			'https://evil.example',
			f.request.requestId,
			key,
		).openRequest(JSON.stringify(f.packet)),
		OperationError,
	);
	await assert.rejects(
		cipher.openRequest(JSON.stringify({ ...f.packet, ciphertext: 'AAAA' })),
		OperationError,
	);
	if (process.env.CONNECT_OPERATION_PACKETS)
		await writeFile(
			process.env.CONNECT_OPERATION_PACKETS,
			JSON.stringify({
				request: await cipher.sealRequest(f.request),
				response: packet,
			}),
		);
	if (process.env.DART_OPERATION_PACKETS) {
		const p = JSON.parse(await readFile(process.env.DART_OPERATION_PACKETS));
		assert.deepEqual(await cipher.openRequest(p.request), f.request);
		assert.deepEqual(await cipher.openResponse(p.response), response);
	}
});

test('adapter registration rejects duplicate chains, reserved methods and missing handlers', () => {
	const a = setup().adapter;
	assert.throws(
		() => new OperationDispatcher({ adapters: [a, a] }),
		OperationError,
	);
	assert.throws(
		() => new OperationDispatcher({ adapters: [{ ...a, handlers: {} }] }),
		OperationError,
	);
	assert.throws(
		() =>
			new OperationDispatcher({
				adapters: [
					{
						...a,
						capabilities: [{ ...base.chain, methods: ['chain.signSecret'] }],
					},
				],
			}),
		OperationError,
	);
});
test('unadvertised standard methods and simultaneous duplicate requests cannot execute', async () => {
	const s = setup({
		adapter: {
			capabilities: [{ ...base.chain, methods: ['chain.getBalance'] }],
		},
	});
	assert.equal(
		(await s.dispatcher.dispatch(request(), origin)).error.code,
		'UNSUPPORTED_OPERATION',
	);
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const pending = setup({ dispatcher: { approve: () => gate } });
	const first = pending.dispatcher.dispatch(request(), origin);
	assert.equal(
		(await pending.dispatcher.dispatch(request(), origin)).error.code,
		'UNAUTHORIZED',
	);
	release(true);
	assert.ok((await first).result);
	assert.equal(pending.counts().executed, 1);
});
test('host results cannot export secret fields or non-JSON data', async () => {
	for (const result of [{ privateKey: 'secret' }, undefined, { balance: 1n }]) {
		const s = setup({
			adapter: {
				handlers: {
					...setup().adapter.handlers,
					'wallet.signTransaction': () => result,
				},
			},
		});
		const response = await s.dispatcher.dispatch(request(), origin);
		assert.ok(response.error);
		assert.ok(!JSON.stringify(response).includes('secret'));
	}
});
test('example covers native EVM, PSBT, Solana, Core and read-only balances', async () => {
	const { createExampleOperations, exampleRequests } =
		await import('../examples/operations.mjs');
	const find = (namespace) =>
		fixture.requests.find((f) => f.request.chain.namespace === namespace)
			.request.account;
	let signed = 0,
		approved = 0,
		read = 0;
	const sign = () => {
		signed++;
		return { signed: 'example' };
	};
	const values = {
		evm: find('eip155'),
		bitcoin: find('bip122'),
		solana: find('solana'),
		core: find('core'),
		evmTransaction: { value: '0x1' },
		psbt: 'cHNidP8=',
		solanaTransaction: 'AQID',
		coreTransaction: { energy: '21000' },
	};
	const dispatcher = createExampleOperations({
		accounts: {
			getAccounts: async () =>
				[values.evm, values.bitcoin, values.solana, values.core].map(
					(account) => ({ account }),
				),
		},
		approve: () => {
			approved++;
			return true;
		},
		validateAccount: () => true,
		validateOperation: () => {},
		signEvm: sign,
		signPsbt: sign,
		signSolana: sign,
		signCore: sign,
		getBalance: () => {
			read++;
			return '100';
		},
	});
	for (const r of exampleRequests(values))
		assert.ok('result' in (await dispatcher.dispatch(r, origin)));
	assert.equal(signed, 4);
	assert.equal(approved, 4);
	assert.equal(read, 1);
});
