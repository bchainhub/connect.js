import { testNearby } from './test-nearby.mjs';
import { testDapp } from './test-dapp.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const assetRoot = process.argv[2]
	? pathToFileURL(resolve(process.argv[2]) + '/')
	: new URL('../', import.meta.url);
const fixtures = JSON.parse(
	await readFile(new URL('test/fixtures/conformance.json', assetRoot)),
);
const helper = await build({
	stdin: {
		contents: `export { ed448 } from '@noble/curves/ed448.js'; export { ed25519 } from '@noble/curves/ed25519.js'; export { base58 } from '@scure/base'; export { coreAddress } from './src/wallet/core.ts';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'browser',
});
const browser = await chromium.launch({ headless: true });
try {
	const context = await browser.newContext({ serviceWorkers: 'block' });
	const unexpected = [];
	await context.route('**/*', async (route) => {
		const url = new URL(route.request().url());
		if (url.origin === 'https://example.com' && url.pathname === '/')
			return route.fulfill({
				contentType: 'text/html',
				body: '<!doctype html><title>Connect browser verification</title>',
			});
		if (
			url.origin === 'https://example.com' &&
			url.pathname === '/examples/browser-only.html'
		)
			return route.fulfill({
				contentType: 'text/html',
				body: await readFile(
					new URL('examples/browser-only.html', assetRoot),
					'utf8',
				),
			});
		if (url.origin === 'https://example.com' && url.pathname === '/helper.js')
			return route.fulfill({
				contentType: 'text/javascript',
				body: helper.outputFiles[0].text,
			});
		if (
			url.origin === 'https://example.com' &&
			/^\/dist\/browser\/[a-zA-Z0-9.-]+\.js$/.test(url.pathname)
		)
			return route.fulfill({
				contentType: 'text/javascript',
				body: await readFile(new URL(url.pathname.slice(1), assetRoot), 'utf8'),
			});
		unexpected.push(url.href);
		await route.abort();
	});
	const page = await context.newPage();
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.error(msg.text());
	});
	await page.goto('https://example.com');
	const output = await page.evaluate(async (fixtures) => {
		const check = (value, label) => {
			if (!value) throw new Error(label);
		};
		const rejects = async (run, label) => {
			let rejected = false;
			try {
				await run();
			} catch {
				rejected = true;
			}
			check(rejected, label);
		};
		const forbiddenAccesses = [];
		const forbidden = (label) => {
			forbiddenAccesses.push(label ?? 'network');
			throw new Error('Network and persistent storage forbidden');
		};
		globalThis.fetch = () => forbidden('network');
		globalThis.XMLHttpRequest = class {
			constructor() {
				forbidden();
			}
		};
		globalThis.WebSocket = class {
			constructor() {
				forbidden();
			}
		};
		for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'caches'])
			Object.defineProperty(globalThis, key, {
				get: () => forbidden('storage:' + key),
			});
		const sdk = await import('/dist/browser/index.js');
		for (const name of [
			'ConnectEngine',
			'MemoryRequestStore',
			'createConnectServer',
			'ConnectDappClient',
			'HttpsNetwork',
		])
			check(!(name in sdk), 'removed API: ' + name);
		const helper = await import('/helper.js');
		const {
			BrowserConnect,
			BrowserConnectRequest,
			ProfileRegistry,
			signBrowserChallenge,
			decodeBrowserChallenge,
			encodeBrowserProof,
		} = sdk;
		const registry = new ProfileRegistry();
		const results = [];
		for (const vector of fixtures) {
			const now = () => Date.parse(vector.challenge.issuedAt) + 1000;
			const request = new BrowserConnectRequest(
				vector.challenge,
				registry,
				now,
			);
			let account;
			try {
				account = await request.verify(vector.proof);
			} catch (error) {
				try {
					await registry
						.get(vector.proof.profile)
						.verify(vector.challenge, vector.proof);
				} catch (cause) {
					throw new Error(vector.name + ': ' + cause.stack);
				}
				throw new Error(vector.name + ': ' + error.stack);
			}
			check(
				JSON.stringify(account) === JSON.stringify(vector.proof.account),
				vector.name,
			);
			await rejects(
				() => request.verify(vector.proof),
				'replay ' + vector.name,
			);
			const tampered = structuredClone(vector.challenge);
			tampered.nonce = 'c'.repeat(64);
			await rejects(
				() =>
					new BrowserConnectRequest(tampered, registry, now).verify(
						vector.proof,
					),
				'nonce ' + vector.name,
			);
			results.push(vector.name);
		}
		let time = Date.now();
		const connect = new BrowserConnect({
			chains: [sdk.chains.core],
			now: () => time,
		});
		const request = connect.create(),
			other = connect.create();
		check(
			request.challenge.requestId !== other.challenge.requestId &&
				request.challenge.nonce !== other.challenge.nonce,
			'secure randomness',
		);
		const challenge = decodeBrowserChallenge(
			request.exportChallenge(),
			'https://example.com',
			time,
		);
		const key = new Uint8Array(57).fill(1),
			pub = helper.ed448.getPublicKey(key);
		const hex = (bytes) =>
			Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
		const walletAccount = {
			account: {
				namespace: 'core',
				reference: '1',
				address: helper.coreAddress(pub),
			},
			profile: 'xcb-ed448',
			alg: -53,
			sign: async (bytes) => ({
				signature: hex(helper.ed448.sign(bytes, key)),
				publicKey: hex(pub),
			}),
		};
		// A verifier may await WASM or a custom implementation; expiry/cancellation must be checked afterward.
		for (const ending of ['expired', 'cancelled']) {
			let pending;
			const base = registry.get('xcb-ed448');
			const delayedRegistry = new ProfileRegistry([
				{
					...base,
					async verify(c, p) {
						const account = await base.verify(c, p);
						if (ending === 'expired') time += 120001;
						else pending.cancel();
						return account;
					},
				},
			]);
			pending = new BrowserConnect({
				chains: [sdk.chains.core],
				registry: delayedRegistry,
				now: () => time,
			}).create();
			const signed = await signBrowserChallenge(
				pending.challenge,
				walletAccount,
				() => time,
			);
			await rejects(
				() => pending.verify(signed),
				ending + ' during verification',
			);
		}
		// Restore the original request clock after the isolated expiry test.
		time = Date.parse(request.challenge.issuedAt);
		check(
			Object.isFrozen(request.challenge) &&
				Object.isFrozen(request.challenge.requirements[0]),
			'immutable challenge',
		);

		const proof = await signBrowserChallenge(
			challenge,
			walletAccount,
			() => time,
		);
		const serialized = encodeBrowserProof(proof);
		await rejects(() => other.verify(serialized), 'wrong request');
		const concurrent = await Promise.allSettled([
			request.verify(serialized),
			request.verify(serialized),
		]);
		check(
			concurrent.filter((r) => r.status === 'fulfilled').length === 1,
			'concurrent replay',
		);
		await rejects(
			() =>
				decodeBrowserChallenge(
					other.exportChallenge(),
					'https://evil.example',
					time,
				),
			'wrong origin',
		);
		await rejects(
			() =>
				decodeBrowserChallenge('x'.repeat(16385), 'https://example.com', time),
			'oversized QR',
		);
		const cancelled = connect.create();
		cancelled.cancel();
		await rejects(() => cancelled.verify(proof), 'cancelled');
		const expiring = connect.create();
		const expiringProof = await signBrowserChallenge(
			expiring.challenge,
			walletAccount,
			() => time,
		);
		time += 120001;
		await rejects(() => expiring.verify(expiringProof), 'expired');
		check(expiring.status === 'EXPIRED', 'expiry state');
		check(
			new BrowserConnect().create().challenge.requirements.length === 16,
			'all chains enabled',
		);
		check(
			typeof globalThis.Buffer === 'undefined' &&
				typeof globalThis.process === 'undefined',
			'no Node globals leaked',
		);
		check(
			forbiddenAccesses.every((label) => label.startsWith('storage:')),
			'No API networking may be attempted',
		);
		return {
			profiles: results,
			optionalStorageChecksBlocked: forbiddenAccesses.length,
			localCoreFlow: 'passed',
			replayExpiryOriginCancellation: 'passed',
		};
	}, fixtures);
	await page.goto('https://example.com/examples/browser-only.html');
	await page.locator('#chain option').nth(1).waitFor({ state: 'attached' });
	await page.locator('#chain').selectOption('0');
	await page.locator('#create').click();
	const response = await page.evaluate(async () => {
		const { decodeBrowserChallenge, signBrowserChallenge, encodeBrowserProof } =
			await import('/dist/browser/index.js');
		const { ed448, coreAddress } = await import('/helper.js');
		const challenge = decodeBrowserChallenge(
			document.getElementById('challenge').value,
			location.origin,
		);
		const key = new Uint8Array(57).fill(1),
			pub = ed448.getPublicKey(key);
		const hex = (bytes) =>
			Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
		return encodeBrowserProof(
			await signBrowserChallenge(challenge, {
				account: {
					namespace: 'core',
					reference: '1',
					address: coreAddress(pub),
				},
				profile: 'xcb-ed448',
				alg: -53,
				sign: async (bytes) => ({
					signature: hex(ed448.sign(bytes, key)),
					publicKey: hex(pub),
				}),
			}),
		);
	});
	await page.locator('#proof').fill(response);
	await page.locator('#verify').click();
	await page.waitForFunction(() =>
		document
			.getElementById('result')
			.textContent.startsWith('Verified core:1:'),
	);
	await page.locator('#create').click();
	await page.locator('#cancel').click();
	if ((await page.locator('#result').textContent()) !== 'Request cancelled.')
		throw new Error('Example cancellation failed');

	await testDapp(context, assetRoot);
	await testNearby(context, assetRoot);
	if (unexpected.length)
		throw new Error('Unexpected network: ' + unexpected.join(', '));
	console.log(JSON.stringify(output, null, 2));
	console.log(
		'Chromium: all profiles and local Core flow passed with no backend, RPC or persistent storage.',
	);
} finally {
	await browser.close();
}
