import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { privateKeyToAccount } from 'viem/accounts';

export async function testDapp(context, assetRoot) {
	await context.route('https://example.com/examples/dapp/**', async (route) => {
		const name = new URL(route.request().url()).pathname.split('/').pop();
		if (!['index.html', 'app.js', 'wallets.js'].includes(name))
			return route.abort();
		return route.fulfill({
			contentType: name.endsWith('.html') ? 'text/html' : 'text/javascript',
			body: await readFile(new URL('examples/dapp/' + name, assetRoot), 'utf8'),
		});
	});
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const signer = privateKeyToAccount('0x' + '01'.repeat(32));
	await page.exposeFunction('testSign', (payload) =>
		signer.signMessage({ message: { raw: payload } }),
	);
	await page.addInitScript(
		({ address }) => {
			window.testWallet = {
				network: '0x1',
				address,
				calls: [],
				reject: false,
				delay: false,
			};
			const listeners = new Map();
			const provider = {
				on(name, callback) {
					if (!listeners.has(name)) listeners.set(name, new Set());
					listeners.get(name).add(callback);
				},
				removeListener(name, callback) {
					listeners.get(name)?.delete(callback);
				},
				async request({ method, params }) {
					window.testWallet.calls.push(method);
					if (method === 'eth_chainId') return window.testWallet.network;
					if (method === 'eth_requestAccounts' || method === 'eth_accounts')
						return [window.testWallet.address];
					if (method === 'personal_sign') {
						if (window.testWallet.reject)
							throw Object.assign(new Error('Rejected'), { code: 4001 });
						if (window.testWallet.delay)
							await new Promise((resolve) => {
								window.releaseSign = resolve;
							});
						return window.testSign(params[0]);
					}
					throw new Error('Unexpected method ' + method);
				},
			};
			window.emitWalletChange = (name) => {
				for (const callback of listeners.get(name) ?? []) callback();
			};
			window.addEventListener('eip6963:requestProvider', () =>
				window.dispatchEvent(
					new CustomEvent('eip6963:announceProvider', {
						detail: {
							info: {
								uuid: '11111111-1111-4111-8111-111111111111',
								name: 'Example <wallet>',
								icon: '',
								rdns: 'example.wallet',
							},
							provider,
						},
					}),
				),
			);
			window.apiCalls = [];
			window.fetch = (...args) => {
				window.apiCalls.push(args);
				throw new Error('No backend allowed');
			};
			for (const key of ['localStorage', 'sessionStorage', 'indexedDB'])
				Object.defineProperty(window, key, {
					get() {
						throw new Error('No storage allowed');
					},
				});
		},
		{ address: signer.address },
	);
	try {
		await page.goto('https://example.com/examples/dapp/index.html');
		await page.locator('#wallet option').first().waitFor({ state: 'attached' });
		assert.deepEqual(
			await page.evaluate(() => window.testWallet.calls),
			[],
			'Discovery must not prompt',
		);
		assert.equal(
			await page.locator('#wallet').textContent(),
			'Example <wallet>',
		);
		assert.equal(
			await page.locator('wallet').count(),
			0,
			'Names are rendered as text',
		);
		await page.locator('#connect').click();
		await page.locator('#review').waitFor({ state: 'visible' });
		assert.ok(
			!(await page.evaluate(() => window.testWallet.calls)).includes(
				'personal_sign',
			),
		);
		assert.match(
			await page.locator('#message').textContent(),
			/example.com wants you to sign in/,
		);
		await page.locator('#sign').click();
		await page.locator('#dashboard').waitFor({ state: 'visible' });
		assert.match(
			await page.locator('#identity').textContent(),
			new RegExp(signer.address),
		);
		assert.equal(await page.locator('#sign').isDisabled(), true);
		await page.evaluate(() => window.emitWalletChange('accountsChanged'));
		assert.equal(await page.locator('#dashboard').isHidden(), true);
		// A selected chain must match the wallet; the example never switches silently.
		await page.locator('#network').selectOption('1');
		await page.locator('#connect').click();
		await page.waitForFunction(() =>
			document
				.getElementById('status')
				.textContent.includes('Switch your wallet'),
		);
		await page.locator('#network').selectOption('0');
		await page.evaluate(() => {
			window.testWallet.reject = true;
		});
		await page.locator('#connect').click();
		await page.locator('#review').waitFor({ state: 'visible' });
		await page.locator('#sign').click();
		await page.waitForFunction(() =>
			document.getElementById('status').textContent.includes('declined'),
		);
		assert.equal(await page.locator('#dashboard').isHidden(), true);
		await page.evaluate(() => {
			window.testWallet.reject = false;
			window.testWallet.delay = true;
		});
		await page.locator('#connect').click();
		await page.locator('#review').waitFor({ state: 'visible' });
		await page.locator('#sign').click();
		await page.waitForFunction(() => typeof window.releaseSign === 'function');
		await page.locator('#cancel').click();
		await page.evaluate(async () => {
			window.releaseSign();
			window.testWallet.delay = false;
		});
		await page.waitForFunction(() =>
			document.getElementById('status').textContent.includes('Signed out'),
		);
		assert.equal(await page.locator('#dashboard').isHidden(), true);
		// A real Core signer registered through the same public host integration API.
		await page.evaluate(async () => {
			const { registerWallet } = await import('./wallets.js');
			const { chains, coreAccountProvider } = await import('connect-protocol');
			const { ed448, coreAddress } = await import('/helper.js');
			const key = new Uint8Array(57).fill(1),
				publicKey = ed448.getPublicKey(key);
			registerWallet({
				id: 'test-core',
				name: 'Core example wallet',
				chains: [chains.core],
				async authorize() {
					return coreAccountProvider({
						getAccounts: async () => [
							{ address: coreAddress(publicKey), publicKey, reference: '1' },
						],
						signConnect: async ({ message }) => ed448.sign(message, key),
					});
				},
			});
		});
		await page.locator('#wallet').selectOption('test-core');
		await page.locator('#connect').click();
		await page.locator('#review').waitFor({ state: 'visible' });
		await page.locator('#sign').click();
		await page.locator('#dashboard').waitFor({ state: 'visible' });
		assert.match(await page.locator('#identity').textContent(), /^core:1:cb/);
		await page.locator('#logout').click();
		assert.equal(await page.locator('#dashboard').isHidden(), true);
		await page.evaluate(async () => {
			const { getStandardWallets } = await import('connect-protocol');
			const { ed25519, base58 } = await import('/helper.js');
			const key = new Uint8Array(32).fill(2),
				publicKey = ed25519.getPublicKey(key);
			const account = {
				address: base58.encode(publicKey),
				publicKey,
				chains: ['solana:mainnet'],
				features: ['solana:signMessage'],
			};
			window.solanaConnects = 0;
			const wallet = {
				version: '1.0.0',
				name: 'Solana example wallet',
				icon: 'data:image/png;base64,',
				chains: ['solana:mainnet'],
				accounts: [account],
				features: {
					'standard:connect': {
						version: '1.0.0',
						async connect() {
							window.solanaConnects++;
							return { accounts: [account] };
						},
					},
					'solana:signMessage': {
						version: '1.0.0',
						async signMessage({ message }) {
							return [
								{
									signedMessage: message,
									signature: ed25519.sign(message, key),
								},
							];
						},
					},
				},
			};
			window.unregisterSolana = getStandardWallets().register(wallet);
		});
		assert.equal(await page.evaluate(() => window.solanaConnects), 0);
		const solanaId = await page
			.locator('#wallet option')
			.filter({ hasText: 'Solana example wallet' })
			.getAttribute('value');
		await page.locator('#wallet').selectOption(solanaId);
		await page.locator('#connect').click();
		await page.locator('#review').waitFor({ state: 'visible' });
		await page.locator('#sign').click();
		await page.locator('#dashboard').waitFor({ state: 'visible' });
		assert.match(await page.locator('#identity').textContent(), /^solana:/);
		assert.equal(await page.evaluate(() => window.solanaConnects), 1);
		await page.evaluate(() => window.unregisterSolana());
		assert.equal(await page.locator('#dashboard').isHidden(), true);

		assert.deepEqual(await page.evaluate(() => window.apiCalls), []);
		assert.deepEqual(errors, []);
		console.log(
			'Dapp example: discovery, Ethereum/Core/Solana signatures, rejection, network mismatch, cancellation, wallet changes and sign-out passed.',
		);
	} finally {
		await page.close();
	}
}
