import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const dartRoot = resolve(process.argv[2] ?? '../flutter_connect');
const directory = await mkdtemp(join(tmpdir(), 'connect-operation-interop-'));
const env = {
	...process.env,
	CONNECT_OPERATION_PACKETS: join(directory, 'typescript.json'),
	DART_OPERATION_PACKETS: join(directory, 'dart.json'),
};
try {
	assert.equal(
		await readFile('test/fixtures/operations/conformance.json', 'utf8'),
		await readFile(
			join(dartRoot, 'test/fixtures/operations/conformance.json'),
			'utf8',
		),
		'Operation fixtures must be identical in both repositories',
	);
	assert.equal(
		await readFile('test/fixtures/wallet-validation.json', 'utf8'),
		await readFile(
			join(dartRoot, 'test/fixtures/wallet-validation.json'),
			'utf8',
		),
		'Wallet address fixtures must be identical',
	);
	const { DART_OPERATION_PACKETS: ignored, ...firstEnv } = env;
	void ignored;
	execFileSync(process.execPath, ['--test', 'test/operations.test.mjs'], {
		env: firstEnv,
		stdio: 'inherit',
	});
	execFileSync(
		'flutter',
		['test', 'test/operations_test.dart', 'test/wallet_validation_test.dart'],
		{
			cwd: dartRoot,
			env,
			stdio: 'inherit',
		},
	);
	execFileSync(process.execPath, ['--test', 'test/operations.test.mjs'], {
		env,
		stdio: 'inherit',
	});
	console.log(
		'Fresh TypeScript ↔ Dart encrypted requests and responses passed.',
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}
