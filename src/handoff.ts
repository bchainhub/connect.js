import { base64urlnopad } from '@scure/base';
import {
	ConnectError,
	connectUri,
	parseConnectUri,
	proofSchema,
	validateChallenge,
	type Challenge,
	type Proof,
} from './protocol.js';
import type { BrowserConnectRequest } from './browser.js';
const encoder = new TextEncoder();
const MAX = 32768;
const hex = (bytes: Uint8Array) =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function keyBytes(key: string) {
	if (!/^[a-f0-9]{64}(?![\s\S])/.test(key))
		throw new ConnectError('invalidHandoff');
	return Uint8Array.from(key.match(/../g)!, (byte) => parseInt(byte, 16));
}
function freeze(c: Challenge) {
	c.requirements.forEach(Object.freeze);
	Object.freeze(c.requirements);
	return Object.freeze(c);
}
export const BLE_CONTROL_UUID = 'b6c01402-df5b-4b79-9f8d-8a642b9cd001';
export const BLE_RESPONSE_UUID = 'b6c01403-df5b-4b79-9f8d-8a642b9cd001';
/** Per-request service UUID, advertised by the wallet after scanning the handoff. */
export function handoffServiceUuid(requestId: string): string {
	if (!/^[a-f0-9]{64}(?![\s\S])/.test(requestId))
		throw new ConnectError('invalidHandoff');
	const value = requestId.slice(0, 32);
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
/** One shared pairing ticket for QR, deep links, BLE or any text/message channel. Never log this object or link. */
export class ConnectHandoff {
	#challenge: Challenge;
	get challenge(): Challenge {
		return this.#challenge;
	}
	#key: string;
	constructor(
		challenge: Challenge,
		key = hex(crypto.getRandomValues(new Uint8Array(32))),
		private readonly now: () => number = Date.now,
	) {
		keyBytes(key);
		this.#challenge = freeze(validateChallenge(challenge, undefined, now()));
		this.#key = key;
	}
	get uri(): string {
		validateChallenge(this.challenge, undefined, this.now());
		const payload = encoder.encode(
			JSON.stringify({
				type: 'connect:handoff:1',
				challenge: this.challenge,
				key: this.#key,
			}),
		);
		return `${connectUri(this.challenge)}#${base64urlnopad.encode(payload)}`;
	}
	get serviceUuid() {
		return handoffServiceUuid(this.challenge.requestId);
	}
	/** Encryption is transport pairing, not a substitute for verifying the wallet signature. */
	async sealProof(input: Proof): Promise<string> {
		const proof = proofSchema.parse(input);
		if (proof.requestId !== this.challenge.requestId)
			throw new ConnectError('invalidHandoff');
		validateChallenge(this.challenge, undefined, this.now());
		const plaintext = encoder.encode(JSON.stringify(proof));
		if (plaintext.length > 16384) throw new ConnectError('invalidHandoff');
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const key = await crypto.subtle.importKey(
			'raw',
			keyBytes(this.#key),
			'AES-GCM',
			false,
			['encrypt'],
		);
		const ciphertext = await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv,
				additionalData: encoder.encode(
					`${this.challenge.origin}/${this.challenge.requestId}`,
				),
			},
			key,
			plaintext,
		);
		return JSON.stringify({
			type: 'connect:response:1',
			requestId: proof.requestId,
			iv: base64urlnopad.encode(iv),
			ciphertext: base64urlnopad.encode(new Uint8Array(ciphertext)),
		});
	}
	async openProof(input: string): Promise<Proof> {
		validateChallenge(this.challenge, undefined, this.now());
		if (input.length > MAX) throw new ConnectError('invalidHandoff');
		try {
			const packet = JSON.parse(input);
			if (
				Object.keys(packet).sort().join(',') !==
					'ciphertext,iv,requestId,type' ||
				packet.type !== 'connect:response:1' ||
				packet.requestId !== this.challenge.requestId
			)
				throw new Error();
			const iv = base64urlnopad.decode(packet.iv);
			if (iv.length !== 12) throw new Error();
			const key = await crypto.subtle.importKey(
				'raw',
				keyBytes(this.#key),
				'AES-GCM',
				false,
				['decrypt'],
			);
			const data = await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: new Uint8Array(iv),
					additionalData: encoder.encode(
						`${this.challenge.origin}/${this.challenge.requestId}`,
					),
				},
				key,
				new Uint8Array(base64urlnopad.decode(packet.ciphertext)),
			);
			const proof = proofSchema.parse(
				JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)),
			);
			if (proof.requestId !== this.challenge.requestId) throw new Error();
			validateChallenge(this.challenge, undefined, this.now());
			return proof;
		} catch {
			throw new ConnectError('invalidHandoff');
		}
	}
}
/** expectedOrigin must come from a trusted channel or explicit wallet-user confirmation. */
export function parseConnectHandoff(
	uri: string,
	expectedOrigin: string,
	now: () => number = Date.now,
): ConnectHandoff {
	try {
		if (uri.length > MAX) throw new Error();
		const parts = uri.split('#');
		if (parts.length !== 2 || !parts[1]) throw new Error();
		const target = parseConnectUri(parts[0], ['connect']);
		const data = JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(
				base64urlnopad.decode(parts[1]),
			),
		);
		if (
			Object.keys(data).sort().join(',') !== 'challenge,key,type' ||
			data.type !== 'connect:handoff:1' ||
			target.origin !== expectedOrigin
		)
			throw new Error();
		return new ConnectHandoff(
			validateChallenge(data.challenge, target, now()),
			data.key,
			now,
		);
	} catch {
		throw new ConnectError('invalidHandoff');
	}
}
export function createBrowserHandoff(request: BrowserConnectRequest) {
	const ticket = new ConnectHandoff(request.challenge);
	return Object.freeze({
		ticket,
		uri: ticket.uri,
		async accept(response: string) {
			return request.verify(await ticket.openProof(response));
		},
	});
}

// Minimal structural interfaces avoid requiring ambient Web Bluetooth types from consumers.
export interface ConnectBluetoothCharacteristic {
	writeValueWithResponse(value: Uint8Array): Promise<void>;
	readValue(): Promise<DataView>;
}
export interface ConnectBluetoothServer {
	getPrimaryService(uuid: string): Promise<{
		getCharacteristic(uuid: string): Promise<ConnectBluetoothCharacteristic>;
	}>;
}
export interface ConnectBluetoothDevice {
	gatt?: {
		readonly connected?: boolean;
		getPrimaryService?: ConnectBluetoothServer['getPrimaryService'];
		connect(): Promise<ConnectBluetoothServer>;
		disconnect(): void;
	};
}
export interface ConnectBluetooth {
	requestDevice(options: {
		filters: { services: string[] }[];
	}): Promise<ConnectBluetoothDevice>;
}
export interface ConnectBluetoothOptions {
	bluetooth?: ConnectBluetooth;
	signal?: AbortSignal;
	/** An already authorized device. Reconnected if necessary, without another chooser. */
	device?: ConnectBluetoothDevice;
}
export function isBluetoothDeviceConnected(
	device: ConnectBluetoothDevice,
): boolean {
	return device.gatt?.connected === true;
}
export function disconnectBluetoothDevice(
	device: ConnectBluetoothDevice,
): void {
	device.gatt?.disconnect();
}
function bluetoothOperation(
	ticket: ConnectHandoff,
	options: ConnectBluetoothOptions,
) {
	const signal = options.signal;
	const check = () => {
		signal?.throwIfAborted();
		validateChallenge(ticket.challenge);
	};
	check();
	const connection: { device?: ConnectBluetoothDevice } = {
		device: options.device,
	};
	const wait = <T>(pending: Promise<T>): Promise<T> =>
		new Promise((resolve, reject) => {
			let finished = false;
			const cleanup = () => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
			};
			const onAbort = () => {
				if (finished) return;
				finished = true;
				cleanup();
				reject(new ConnectError('cancelled'));
			};
			const timer = setTimeout(
				() => {
					if (finished) return;
					finished = true;
					cleanup();
					reject(new ConnectError('bluetoothTimeout'));
				},
				Math.max(
					1,
					Math.min(15000, Date.parse(ticket.challenge.expiresAt) - Date.now()),
				),
			);
			signal?.addEventListener('abort', onAbort, { once: true });
			pending.then(
				(value) => {
					if (finished) {
						connection.device?.gatt?.disconnect();
						return;
					}
					finished = true;
					cleanup();
					resolve(value);
				},
				(error) => {
					if (finished) return;
					finished = true;
					cleanup();
					reject(error);
				},
			);
			if (signal?.aborted) onAbort();
		});
	const disconnect = () => connection.device?.gatt?.disconnect();
	async function connect() {
		check();
		signal?.addEventListener('abort', disconnect, { once: true });
		try {
			if (!connection.device) {
				const bluetooth =
					options.bluetooth ??
					(globalThis.navigator as Navigator & { bluetooth?: ConnectBluetooth })
						?.bluetooth;
				if (!bluetooth) throw new ConnectError('bluetoothUnavailable');
				connection.device = await wait(
					bluetooth.requestDevice({
						filters: [{ services: [ticket.serviceUuid] }],
					}),
				);
			}
			check();
			const gatt = connection.device.gatt;
			if (!gatt) throw new ConnectError('bluetoothUnavailable');
			const server =
				gatt.connected && gatt.getPrimaryService
					? { getPrimaryService: gatt.getPrimaryService.bind(gatt) }
					: await wait(gatt.connect());
			check();
			return { device: connection.device, server };
		} catch (error) {
			disconnect();
			throw error;
		} finally {
			signal?.removeEventListener('abort', disconnect);
		}
	}
	return { check, wait, connect, disconnect };
}
/** Select and connect a nearby wallet. Call from a user gesture when no device is supplied. */
export async function connectBluetoothDevice(
	ticket: ConnectHandoff,
	options: ConnectBluetoothOptions = {},
): Promise<ConnectBluetoothDevice> {
	const operation = bluetoothOperation(ticket, options);
	const { device, server } = await operation.connect();
	try {
		// Ensure the selected device exposes this request's service before returning it.
		await operation.wait(server.getPrimaryService(ticket.serviceUuid));
		operation.check();
		return device;
	} catch (error) {
		operation.disconnect();
		throw error;
	}
}
/** Chooses/connects if needed; supplying a disconnected authorized device reconnects it.
 * Call from a click handler if the browser may need to show its permission chooser.
 * A transfer always disconnects on completion or failure. Retry after a dropped link.
 */
export async function receiveBluetoothResponse(
	ticket: ConnectHandoff,
	options: ConnectBluetoothOptions = {},
): Promise<string> {
	const { check, wait, connect, disconnect } = bluetoothOperation(
		ticket,
		options,
	);
	const signal = options.signal;
	try {
		const { server } = await connect();
		signal?.addEventListener('abort', disconnect, { once: true });
		const service = await wait(server.getPrimaryService(ticket.serviceUuid));
		const control = await wait(service.getCharacteristic(BLE_CONTROL_UUID)),
			response = await wait(service.getCharacteristic(BLE_RESPONSE_UUID));
		let total = 0,
			offset = 0;
		let bytes: Uint8Array | undefined;
		while (true) {
			check();
			const command = new Uint8Array(4);
			new DataView(command.buffer).setUint32(0, offset, true);
			await wait(control.writeValueWithResponse(command));
			check();
			const frame = await wait(response.readValue());
			check();
			if (frame.byteLength < 8 || frame.byteLength > 20)
				throw new ConnectError('invalidBluetoothFrame');
			const size = frame.getUint32(0, true),
				position = frame.getUint32(4, true);
			if (
				size === 0 &&
				offset === 0 &&
				frame.byteLength === 8 &&
				position === 0
			) {
				await new Promise((resolve) => setTimeout(resolve, 250));
				continue;
			}
			if (
				size === 0 ||
				size > MAX ||
				position !== offset ||
				(total && size !== total) ||
				frame.byteLength === 8 ||
				offset + frame.byteLength - 8 > size
			)
				throw new ConnectError('invalidBluetoothFrame');
			if (!bytes) {
				total = size;
				bytes = new Uint8Array(total);
			}
			bytes.set(
				new Uint8Array(
					frame.buffer,
					frame.byteOffset + 8,
					frame.byteLength - 8,
				),
				offset,
			);
			offset += frame.byteLength - 8;
			if (offset === total)
				return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		}
	} finally {
		signal?.removeEventListener('abort', disconnect);
		disconnect();
	}
}
