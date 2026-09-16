import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	validateWalletAccount,
	isValidWalletAccount,
} from '../dist/wallet-validation.js';
import { withWalletValidation } from '../dist/operation-validation.js';
import { OperationDispatcher, createOperation } from '../dist/operations.js';
const cases = JSON.parse(
	await readFile(new URL('./fixtures/wallet-validation.json', import.meta.url)),
);
for (const c of cases)
	test(`address: ${c.name}`, () => {
		assert.equal(validateWalletAccount(c.account).status, c.status);
		assert.equal(isValidWalletAccount(c.account), c.status === 'valid');
	});
test('validation wrapper runs before approval and retains host validation', async () => {
	let approved = 0,
		executed = 0,
		checked = 0;
	const account = cases.find(
		(c) => c.name === 'EVM bad mixed checksum',
	).account;
	const adapter = withWalletValidation({
		capabilities: [
			{
				namespace: account.namespace,
				reference: account.reference,
				methods: ['wallet.signTransaction'],
			},
		],
		validateAccount: () => {
			checked++;
			return true;
		},
		validateOperation: () => {},
		handlers: {
			'wallet.signTransaction': () => {
				executed++;
				return null;
			},
		},
	});
	const d = new OperationDispatcher({
		adapters: [adapter],
		accounts: { getAccounts: async () => [{ account }] },
		approve: () => {
			approved++;
			return true;
		},
	});
	const r = await d.dispatch(
		createOperation({
			operation: 'wallet.signTransaction',
			chain: { namespace: account.namespace, reference: account.reference },
			account,
			params: {},
		}),
		'https://example.com',
	);
	assert.equal(r.error.code, 'UNSUPPORTED_ACCOUNT');
	assert.equal(approved, 0);
	assert.equal(executed, 0);
	assert.equal(checked, 0);
	const good = cases.find((c) => c.name === 'ethereum-siwe').account;
	assert.equal(await adapter.validateAccount(good), true);
	assert.equal(checked, 1);
	const denied = withWalletValidation({
		...adapter,
		validateAccount: () => false,
	});
	assert.equal(await denied.validateAccount(good), false);
	const unsupported = cases.find((c) => c.name === 'Monero').account;
	assert.equal(await adapter.validateAccount(unsupported), true);
	assert.equal(isValidWalletAccount(unsupported), false);
});
