import { base64urlnopad } from '@scure/base';
import { idSchema, validateOrigin } from './protocol.js';
import {
	OperationError,
	MAX_OPERATION_BYTES,
	parseOperation,
	parseOperationResponse,
	serializeOperation,
	serializeOperationResponse,
	type ConnectOperation,
	type OperationResponse,
} from './operations.js';

/** AES-GCM pairing codec using Connect's existing 256-bit key / 96-bit nonce convention.
 * Pairing keys come from a trusted host channel, never from a wallet's signing key.
 * Keep keys and pairing links out of logs. This does not authenticate wallet ownership. */
export class OperationCipher {
	#key: Uint8Array;
	#origin: string;
	#requestId: string;
	constructor(origin: string, requestId: string, pairingKey: Uint8Array) {
		try {
			this.#origin = validateOrigin(origin);
			this.#requestId = idSchema.parse(requestId);
			if (!(pairingKey instanceof Uint8Array) || pairingKey.length !== 32)
				throw new Error();
			this.#key = pairingKey.slice();
		} catch {
			throw new OperationError('INVALID_PARAMS');
		}
	}
	async sealRequest(request: ConnectOperation): Promise<string> {
		if (request.requestId !== this.#requestId)
			throw new OperationError('INVALID_PARAMS');
		return this.seal(serializeOperation(request), 'request');
	}
	async sealResponse(response: OperationResponse): Promise<string> {
		if (response.requestId !== this.#requestId)
			throw new OperationError('INVALID_PARAMS');
		return this.seal(serializeOperationResponse(response), 'response');
	}
	async openRequest(packet: string): Promise<ConnectOperation> {
		const request = parseOperation(await this.open(packet, 'request'));
		if (request.requestId !== this.#requestId)
			throw new OperationError('INVALID_PARAMS');
		return request;
	}
	async openResponse(packet: string): Promise<OperationResponse> {
		return parseOperationResponse(
			await this.open(packet, 'response'),
			this.#requestId,
		);
	}
	private aad(kind: string) {
		return new TextEncoder().encode(
			`connect:operation:1/${kind}/${this.#origin}/${this.#requestId}`,
		);
	}
	private async seal(plaintext: string, kind: string): Promise<string> {
		try {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const key = await crypto.subtle.importKey(
				'raw',
				new Uint8Array(this.#key),
				'AES-GCM',
				false,
				['encrypt'],
			);
			const bytes = await crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv, additionalData: this.aad(kind) },
				key,
				new TextEncoder().encode(plaintext),
			);
			return JSON.stringify({
				type: 'connect:operation:encrypted:1',
				kind,
				requestId: this.#requestId,
				iv: base64urlnopad.encode(iv),
				ciphertext: base64urlnopad.encode(new Uint8Array(bytes)),
			});
		} catch {
			throw new OperationError('INVALID_PARAMS');
		}
	}
	private async open(input: string, kind: string): Promise<string> {
		try {
			if (input.length > 32768) throw new Error();
			const p = JSON.parse(input);
			if (
				Object.keys(p).sort().join(',') !==
					'ciphertext,iv,kind,requestId,type' ||
				p.type !== 'connect:operation:encrypted:1' ||
				p.kind !== kind ||
				p.requestId !== this.#requestId
			)
				throw new Error();
			const iv = base64urlnopad.decode(p.iv),
				ciphertext = base64urlnopad.decode(p.ciphertext);
			if (
				iv.length !== 12 ||
				ciphertext.length > MAX_OPERATION_BYTES + 16 ||
				base64urlnopad.encode(iv) !== p.iv ||
				base64urlnopad.encode(ciphertext) !== p.ciphertext
			)
				throw new Error();
			const key = await crypto.subtle.importKey(
				'raw',
				new Uint8Array(this.#key),
				'AES-GCM',
				false,
				['decrypt'],
			);
			const bytes = await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: new Uint8Array(iv),
					additionalData: this.aad(kind),
				},
				key,
				new Uint8Array(ciphertext),
			);
			return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			throw new OperationError('INVALID_PARAMS');
		}
	}
}
