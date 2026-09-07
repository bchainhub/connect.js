import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	ConnectHandoff,
	parseConnectHandoff,
	receiveBluetoothResponse,
	BLE_CONTROL_UUID,
} from '../dist/index.js';
const vectors = JSON.parse(
	readFileSync(new URL('./fixtures/conformance.json', import.meta.url)),
);
const now = () => Date.parse('2026-09-07T10:00:00.000Z');
for (const v of vectors)
	test('encrypted handoff ' + v.name, async () => {
		const ticket = new ConnectHandoff(v.challenge, '01'.repeat(32), now);
		const wallet = parseConnectHandoff(ticket.uri, v.challenge.origin, now);
		const response = await wallet.sealProof(v.proof);
		assert.deepEqual(await ticket.openProof(response), v.proof);
		assert.notEqual(response, await wallet.sealProof(v.proof));
		await assert.rejects(
			new ConnectHandoff(v.challenge, '02'.repeat(32), now).openProof(response),
		);
		const packet = JSON.parse(response);
		packet.ciphertext =
			(packet.ciphertext[0] === 'A' ? 'B' : 'A') + packet.ciphertext.slice(1);
		await assert.rejects(ticket.openProof(JSON.stringify(packet)));
		assert.throws(() =>
			parseConnectHandoff(ticket.uri, 'https://evil.example', now),
		);
		assert.throws(() =>
			parseConnectHandoff(ticket.uri + '#extra', v.challenge.origin, now),
		);
		assert.throws(() =>
			parseConnectHandoff(ticket.uri, v.challenge.origin, () => now() + 300000),
		);
	});
test('Bluetooth reassembles bounded frames and disconnects on success and failure', async () => {
	const challenge = {
		...vectors[0].challenge,
		issuedAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 120000).toISOString(),
	};
	const ticket = new ConnectHandoff(challenge);
	const packet = await ticket.sealProof(vectors[0].proof);
	const bytes = new TextEncoder().encode(packet);
	let offset = 0,
		disconnected = 0,
		bad = false;
	const bluetooth = {
		async requestDevice(options) {
			assert.deepEqual(options.filters, [{ services: [ticket.serviceUuid] }]);
			return {
				gatt: {
					disconnect() {
						disconnected++;
					},
					async connect() {
						return {
							async getPrimaryService(uuid) {
								assert.equal(uuid, ticket.serviceUuid);
								return {
									async getCharacteristic(id) {
										return id === BLE_CONTROL_UUID
											? {
													async writeValueWithResponse(value) {
														offset = new DataView(value.buffer).getUint32(
															0,
															true,
														);
													},
												}
											: {
													async readValue() {
														const part = bytes.slice(offset, offset + 12),
															frame = new Uint8Array(8 + part.length),
															view = new DataView(frame.buffer);
														view.setUint32(0, bad ? 32769 : bytes.length, true);
														view.setUint32(4, offset, true);
														frame.set(part, 8);
														return view;
													},
												};
									},
								};
							},
						};
					},
				},
			};
		},
	};
	assert.equal(await receiveBluetoothResponse(ticket, { bluetooth }), packet);
	assert.equal(disconnected, 1);
	bad = true;
	await assert.rejects(receiveBluetoothResponse(ticket, { bluetooth }));
	assert.equal(disconnected, 2);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		receiveBluetoothResponse(ticket, { bluetooth, signal: controller.signal }),
	);
});
test('Dart response packets decrypt to identical proofs', async () => {
	const path = process.env.CONNECT_DART_RESPONSES;
	if (!path) return;
	for (const [i, response] of JSON.parse(readFileSync(path)).entries()) {
		assert.deepEqual(
			await new ConnectHandoff(
				vectors[i].challenge,
				'01'.repeat(32),
				now,
			).openProof(response),
			vectors[i].proof,
		);
	}
});

test('encrypted transport still requires a valid wallet signature and single-use verification', async () => {
	const { BrowserConnect, createBrowserHandoff, signBrowserChallenge } =
		await import('../dist/index.js');
	const { ed25519 } = await import('@noble/curves/ed25519.js');
	const key = new Uint8Array(32).fill(1),
		pub = Buffer.from(ed25519.getPublicKey(key)).toString('hex');
	const request = new BrowserConnect({
		origin: 'https://example.com',
		requirements: [
			{
				namespace: 'raw',
				reference: 'ed25519',
				profile: 'raw-ed25519',
				alg: -19,
			},
		],
	}).create();
	const handoff = createBrowserHandoff(request);
	const proof = await signBrowserChallenge(request.challenge, {
		account: { namespace: 'raw', reference: 'ed25519', address: pub },
		profile: 'raw-ed25519',
		alg: -19,
		sign: async (bytes) => ({
			signature: Buffer.from(ed25519.sign(bytes, key)).toString('hex'),
			publicKey: pub,
		}),
	});
	await assert.rejects(
		handoff.accept(
			await handoff.ticket.sealProof({ ...proof, signature: '00'.repeat(64) }),
		),
	);
	assert.equal(request.status, 'PENDING');
	const packet = await handoff.ticket.sealProof(proof);
	assert.equal((await handoff.accept(packet)).address, pub);
	await assert.rejects(handoff.accept(packet));
});

test('explicit device connection, reuse and disconnected-device transfer', async () => {
	const {
		connectBluetoothDevice,
		disconnectBluetoothDevice,
		isBluetoothDeviceConnected,
	} = await import('../dist/index.js');
	const ticket = new ConnectHandoff({
		...vectors[0].challenge,
		issuedAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 120000).toISOString(),
	});
	const packet = await ticket.sealProof(vectors[0].proof),
		bytes = new TextEncoder().encode(packet);
	let offset = 0,
		connects = 0,
		choices = 0;
	const service = {
		async getCharacteristic(id) {
			return id === BLE_CONTROL_UUID
				? {
						async writeValueWithResponse(value) {
							offset = new DataView(value.buffer).getUint32(0, true);
						},
					}
				: {
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
		},
	};
	const gatt = {
		connected: false,
		async connect() {
			connects++;
			this.connected = true;
			return this;
		},
		disconnect() {
			this.connected = false;
		},
		async getPrimaryService(uuid) {
			assert.equal(uuid, ticket.serviceUuid);
			return service;
		},
	};
	const device = { gatt },
		bluetooth = {
			async requestDevice() {
				choices++;
				return device;
			},
		};
	assert.equal(await connectBluetoothDevice(ticket, { bluetooth }), device);
	assert.equal(isBluetoothDeviceConnected(device), true);
	assert.equal(connects, 1);
	assert.equal(
		await receiveBluetoothResponse(ticket, { device, bluetooth }),
		packet,
	);
	assert.equal(connects, 1);
	assert.equal(choices, 1);
	assert.equal(isBluetoothDeviceConnected(device), false);
	// A disconnected authorized device reconnects without another chooser.
	assert.equal(
		await receiveBluetoothResponse(ticket, { device, bluetooth }),
		packet,
	);
	assert.equal(connects, 2);
	assert.equal(choices, 1);
	await connectBluetoothDevice(ticket, { device });
	disconnectBluetoothDevice(device);
	assert.equal(isBluetoothDeviceConnected(device), false);
	await assert.rejects(
		connectBluetoothDevice(ticket, {
			bluetooth: {
				async requestDevice() {
					throw new Error('Permission denied');
				},
			},
		}),
		/Permission denied/,
	);
	await assert.rejects(connectBluetoothDevice(ticket, { device: {} }));
	gatt.getPrimaryService = async () => {
		throw new Error('Wrong request service');
	};
	await assert.rejects(
		connectBluetoothDevice(ticket, { device }),
		/Wrong request service/,
	);
	assert.equal(gatt.connected, false);
});

test('aborted connection is disconnected even when native connect resolves late', async () => {
	const { connectBluetoothDevice } = await import('../dist/index.js');
	const ticket = new ConnectHandoff({
		...vectors[0].challenge,
		issuedAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 120000).toISOString(),
	});
	let finish,
		connected = false,
		started;
	const ready = new Promise((resolve) => {
		started = resolve;
	});
	const device = {
		gatt: {
			async connect() {
				started();
				await new Promise((resolve) => {
					finish = resolve;
				});
				connected = true;
				return {};
			},
			disconnect() {
				connected = false;
			},
		},
	};
	const controller = new AbortController();
	const pending = connectBluetoothDevice(ticket, {
		device,
		signal: controller.signal,
	});
	await ready;
	controller.abort();
	await assert.rejects(pending);
	finish();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(connected, false);
});
