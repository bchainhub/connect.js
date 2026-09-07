import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const directory = await mkdtemp(join(tmpdir(), 'connect-browser-package-'));
const run = (args, cwd = process.cwd()) =>
	execFileSync('npm', args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'inherit'],
	});
try {
	const [packed] = JSON.parse(
		run(['pack', '--json', '--pack-destination', directory]),
	);
	for (const file of packed.files) {
		assert.ok(!/(?:^|\/)server\//.test(file.path), file.path);
		assert.ok(
			!/(?:^|\/)(?:dapp|evm)\.(?:js|d\.ts)$/.test(file.path),
			file.path,
		);
		assert.ok(!file.path.includes('node_modules/'), file.path);
		if (file.path.endsWith('.js'))
			assert.ok(
				file.path.startsWith('dist/browser/') ||
					[
						'examples/dapp/app.js',
						'examples/dapp/wallets.js',
						'examples/nearby/app.js',
					].includes(file.path),
				file.path,
			);
	}
	await writeFile(
		join(directory, 'package.json'),
		JSON.stringify({ private: true, type: 'module' }),
	);
	run(
		[
			'install',
			'--ignore-scripts',
			'--omit=dev',
			'--package-lock=true',
			join(directory, packed.filename),
		],
		directory,
	);
	await writeFile(
		join(directory, 'verify.mjs'),
		`
		import assert from 'node:assert/strict';
		import { readFileSync } from 'node:fs';
		import * as sdk from 'connect-protocol';
		import * as wallet from 'connect-protocol/wallet';
		for (const name of ['BrowserConnect','signBrowserChallenge','ProfileRegistry','coreAccountProvider','ethereumAccountProvider']) assert.equal(typeof sdk[name],'function');
		assert.equal(typeof wallet.coreAccountProvider,'function');
		for (const name of ['ConnectEngine','MemoryRequestStore','createConnectServer','ConnectDappClient','HttpsNetwork']) assert.ok(!(name in sdk));
		for (const subpath of ['server','dapp','browser','evm']) await assert.rejects(import('connect-protocol/'+subpath), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
		const manifest=JSON.parse(readFileSync(new URL('./node_modules/connect-protocol/package.json',import.meta.url)));
		assert.ok(!manifest.engines);
		assert.ok(!manifest.dependencies['monero-ts']);
		assert.ok(!manifest.bundleDependencies);
		console.log('Installed main entry is browser-only; removed APIs and server files are absent.');
	`,
	);
	execFileSync(process.execPath, ['verify.mjs'], {
		cwd: directory,
		stdio: 'inherit',
	});
	// Exercise the installed tarball's actual browser chunks, not the source checkout.
	execFileSync(
		process.execPath,
		[
			fileURLToPath(new URL('./test-browser.mjs', import.meta.url)),
			join(directory, 'node_modules/connect-protocol'),
		],
		{ stdio: 'inherit' },
	);
	await writeFile(
		join(directory, 'consumer.ts'),
		`import { BrowserConnect, signBrowserChallenge, type WalletAccount } from 'connect-protocol';\nimport { ProfileRegistry } from 'connect-protocol/verification';\ndeclare const account: WalletAccount;\nconst request = new BrowserConnect({registry:new ProfileRegistry()}).create();\nawait request.verify(await signBrowserChallenge(request.challenge, account));\n`,
	);
	execFileSync(
		process.execPath,
		[
			fileURLToPath(
				new URL('../node_modules/typescript/bin/tsc', import.meta.url),
			),
			'--noEmit',
			'--strict',
			'--skipLibCheck',
			'--target',
			'ES2022',
			'--module',
			'NodeNext',
			'--moduleResolution',
			'NodeNext',
			'consumer.ts',
		],
		{ cwd: directory, stdio: 'inherit' },
	);
	const audit = JSON.parse(run(['audit', '--omit=dev', '--json'], directory));
	assert.equal(audit.metadata.vulnerabilities.total, 0);
	console.log(
		'Browser package, TypeScript consumer and production dependency audit passed.',
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}
