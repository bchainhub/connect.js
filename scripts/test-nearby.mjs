import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export async function testNearby(context, assetRoot) {
	await context.route(
		'https://example.com/examples/nearby/*',
		async (route) => {
			const path = new URL(route.request().url()).pathname.slice(1);
			await route.fulfill({
				contentType: path.endsWith('.js') ? 'text/javascript' : 'text/html',
				body: await readFile(new URL(path, assetRoot), 'utf8'),
			});
		},
	);
	const page = await context.newPage();
	page.setDefaultTimeout(10000);
	const errors = [];
	page.on(
		'pageerror',
		(error) => (
			errors.push(error.message),
			console.error('Nearby:', error.message)
		),
	);
	await page.goto('https://example.com/examples/nearby/index.html');
	for (const mode of ['manual', 'automatic', 'explicit']) {
		const bluetooth = mode !== 'manual';
		await page.locator('#create').click();
		await page.waitForFunction(() =>
			document.getElementById('link').href.startsWith('connect://'),
		);
		const packet = await page.evaluate(async (bluetooth) => {
			const sdk = await import('/dist/browser/index.js');
			const { ed25519 } = await import('/helper.js');
			const ticket = sdk.parseConnectHandoff(
				document.getElementById('link').href,
				location.origin,
			);
			const key = new Uint8Array(32).fill(1);
			const hex = (b) =>
				Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
			const pub = hex(ed25519.getPublicKey(key));
			const proof = await sdk.signBrowserChallenge(ticket.challenge, {
				account: { namespace: 'raw', reference: 'ed25519', address: pub },
				profile: 'raw-ed25519',
				alg: -19,
				sign: async (bytes) => ({
					signature: hex(ed25519.sign(bytes, key)),
					publicKey: pub,
				}),
			});
			const packet = await ticket.sealProof(proof);
			if (bluetooth) {
				const bytes = new TextEncoder().encode(packet);
				let offset = 0;
				const control = {
					async writeValueWithResponse(v) {
						offset = new DataView(v.buffer).getUint32(0, true);
					},
				};
				const response = {
					async readValue() {
						const part = bytes.slice(offset, offset + 12),
							frame = new Uint8Array(8 + part.length),
							view = new DataView(frame.buffer);
						view.setUint32(0, bytes.length, true);
						view.setUint32(4, offset, true);
						frame.set(part, 8);
						return view;
					},
				};
				const service = {
					async getCharacteristic(id) {
						return id === sdk.BLE_CONTROL_UUID ? control : response;
					},
				};
				const server = {
					async getPrimaryService() {
						return service;
					},
				};
				const gatt = {
					disconnect() {},
					async connect() {
						return server;
					},
				};
				Object.defineProperty(navigator, 'bluetooth', {
					configurable: true,
					value: {
						async requestDevice() {
							return { gatt };
						},
					},
				});
			}
			return packet;
		}, bluetooth);
		if (mode === 'explicit') {
			await page.locator('#connect').click();
			await page.waitForFunction(() =>
				document
					.getElementById('status')
					.textContent.startsWith('Device connected.'),
			);
		}
		if (bluetooth) await page.locator('#bluetooth').click();
		else {
			await page.locator('#response').fill(packet);
			await page.locator('#accept').click();
		}
		await page.waitForFunction(() =>
			document
				.getElementById('status')
				.textContent.startsWith('Wallet verified:'),
		);
		assert.equal(await page.locator('#accept').isDisabled(), true);
	}
	assert.deepEqual(errors, []);
	await page.close();
	console.log(
		'Nearby example: real Ed25519 signatures, QR rendering, manual return and simulated BLE passed.',
	);
}
