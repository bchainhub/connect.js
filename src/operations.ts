import { z } from 'zod';
import {
	accountSchema,
	idSchema,
	validateOrigin,
	type Account,
} from './protocol.js';
import type { AccountProvider } from './wallet.js';

export const operationMethods = Object.freeze({
	getAccounts: 'wallet.getAccounts',
	signMessage: 'wallet.signMessage',
	signTransaction: 'wallet.signTransaction',
	sendTransaction: 'wallet.sendTransaction',
	switchChain: 'wallet.switchChain',
	addChain: 'wallet.addChain',
	signTypedData: 'wallet.signTypedData',
	signPsbt: 'wallet.signPsbt',
	signAllTransactions: 'wallet.signAllTransactions',
	getBalance: 'chain.getBalance',
	getTransaction: 'chain.getTransaction',
	getBlock: 'chain.getBlock',
	estimateFee: 'chain.estimateFee',
	call: 'chain.call',
} as const);
export const operationErrorMessages = Object.freeze({
	UNSUPPORTED_OPERATION: 'Operation is not supported.',
	UNSUPPORTED_CHAIN: 'Chain is not supported.',
	UNSUPPORTED_ACCOUNT: 'Account is not available.',
	INVALID_PARAMS: 'Invalid operation parameters.',
	INVALID_TRANSACTION: 'Invalid transaction.',
	USER_REJECTED: 'User rejected the operation.',
	UNAUTHORIZED: 'Operation is not authorized.',
	SIGNING_FAILED: 'Wallet signing failed.',
	BROADCAST_FAILED: 'Transaction broadcast failed.',
	CHAIN_UNAVAILABLE: 'Chain is unavailable.',
	TIMEOUT: 'Operation timed out.',
	INTERNAL_ERROR: 'Operation failed.',
} as const);
export type OperationErrorCode = keyof typeof operationErrorMessages;
/** Only stable codes cross the trust boundary; arbitrary exception messages never do. */
export class OperationError extends Error {
	constructor(readonly code: OperationErrorCode) {
		super(operationErrorMessages[code]);
		this.name = 'OperationError';
	}
}
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export interface OperationChain {
	readonly namespace: string;
	readonly reference: string;
}
export interface ConnectOperation<TParams extends JsonObject = JsonObject> {
	readonly version: 1;
	readonly requestId: string;
	readonly operation: string;
	readonly chain: OperationChain;
	readonly account?: Account;
	readonly params: TParams;
	readonly metadata?: JsonObject;
}
export type ConnectResult<TResult extends JsonValue = JsonValue> = {
	readonly version: 1;
	readonly requestId: string;
	readonly result: TResult;
};
export interface ConnectOperationFailure {
	readonly version: 1;
	/** Null only when a malformed request has no usable identifier. */
	readonly requestId: string | null;
	readonly error: {
		readonly code: OperationErrorCode;
		readonly message: string;
		readonly details?: JsonObject;
	};
}
export type OperationResponse = ConnectResult | ConnectOperationFailure;
export interface OperationCapability extends OperationChain {
	readonly methods: readonly string[];
}
export const MAX_OPERATION_BYTES = 16384;
const atom = accountSchema.shape.namespace;
const chainSchema = z.object({ namespace: atom, reference: atom }).strict();
const methodSchema = z
	.string()
	.max(128)
	.regex(/^[a-z][a-z0-9]*\.[a-zA-Z][a-zA-Z0-9]*(?![\s\S])/);
const objectSchema = z.record(z.string(), z.unknown());
const requestSchema = z
	.object({
		version: z.literal(1),
		requestId: idSchema,
		operation: methodSchema,
		chain: chainSchema,
		account: accountSchema.optional(),
		params: objectSchema,
		metadata: objectSchema.optional(),
	})
	.strict();
const codes = Object.keys(operationErrorMessages) as OperationErrorCode[];
const responseSchema = z.union([
	z
		.object({ version: z.literal(1), requestId: idSchema, result: z.unknown() })
		.strict()
		.refine((v) => Object.hasOwn(v, 'result')),
	z
		.object({
			version: z.literal(1),
			requestId: idSchema.nullable(),
			error: z
				.object({
					code: z.enum(codes),
					message: z.string().min(1).max(256),
					details: objectSchema.optional(),
				})
				.strict(),
		})
		.strict(),
]);
const capabilitySchema = z
	.object({
		namespace: atom,
		reference: atom,
		methods: z.array(methodSchema).max(128),
	})
	.strict();
function fail(code: OperationErrorCode = 'INVALID_PARAMS'): never {
	throw new OperationError(code);
}
/** Copy only plain JSON, bound nesting, and reject common secret-bearing fields. */
function snapshot(value: unknown, depth = 0): JsonValue {
	if (depth > 32) fail();
	if (value === null || typeof value === 'string' || typeof value === 'boolean')
		return value;
	if (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		(!Number.isInteger(value) || Number.isSafeInteger(value))
	)
		return value;
	if (Array.isArray(value))
		return Object.freeze(value.map((v) => snapshot(v, depth + 1)));
	if (
		!value ||
		typeof value !== 'object' ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		fail();
	const result: Record<string, JsonValue> = {};
	for (const [key, descriptor] of Object.entries(
		Object.getOwnPropertyDescriptors(value),
	)) {
		if (
			!descriptor.enumerable ||
			!('value' in descriptor) ||
			/^(?:proto|prototype|constructor|privatekey|secretkey|mnemonic|seedphrase)$/i.test(
				key.replace(/[_-]/g, ''),
			)
		)
			fail();
		result[key] = snapshot(descriptor.value, depth + 1);
	}
	return Object.freeze(result);
}
function inputJson(input: unknown): JsonValue {
	try {
		if (typeof input === 'string') {
			if (new TextEncoder().encode(input).length > MAX_OPERATION_BYTES) fail();
			input = JSON.parse(input);
		}
		const result = snapshot(input);
		if (
			new TextEncoder().encode(JSON.stringify(result)).length >
			MAX_OPERATION_BYTES
		)
			fail();
		return result;
	} catch {
		return fail();
	}
}
function frozen<T>(value: T): T {
	return snapshot(value) as T;
}
export function parseOperation(input: unknown): ConnectOperation {
	try {
		const r = requestSchema.parse(inputJson(input));
		if (
			r.account &&
			(r.account.namespace !== r.chain.namespace ||
				r.account.reference !== r.chain.reference)
		)
			fail('UNSUPPORTED_ACCOUNT');
		return frozen(r) as ConnectOperation;
	} catch (e) {
		if (e instanceof OperationError) throw e;
		return fail();
	}
}
export function serializeOperation(request: ConnectOperation): string {
	return JSON.stringify(parseOperation(request));
}
export function parseOperationResponse(
	input: unknown,
	expectedRequestId?: string,
): OperationResponse {
	try {
		const r = responseSchema.parse(inputJson(input));
		if (
			expectedRequestId !== undefined &&
			r.requestId !== idSchema.parse(expectedRequestId)
		)
			fail();
		return frozen(r) as OperationResponse;
	} catch {
		return fail();
	}
}
export function serializeOperationResponse(
	response: OperationResponse,
): string {
	return JSON.stringify(parseOperationResponse(response));
}
export function parseCapabilities(
	input: unknown,
): readonly OperationCapability[] {
	try {
		const result = z.array(capabilitySchema).max(128).parse(inputJson(input));
		const seen = new Set<string>();
		for (const c of result) {
			const key = `${c.namespace}:${c.reference}`;
			if (seen.has(key) || new Set(c.methods).size !== c.methods.length) fail();
			seen.add(key);
			c.methods.forEach(validateMethod);
		}
		return frozen(result);
	} catch {
		return fail();
	}
}
export function supportsOperation(
	capabilities: readonly OperationCapability[],
	chain: OperationChain,
	method: string,
): boolean {
	return capabilities.some(
		(c) =>
			c.namespace === chain.namespace &&
			c.reference === chain.reference &&
			c.methods.includes(method),
	);
}
export function createOperation(
	input: Omit<ConnectOperation, 'version' | 'requestId'> & {
		requestId?: string;
	},
): ConnectOperation {
	const requestId =
		input.requestId ??
		Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
			b.toString(16).padStart(2, '0'),
		).join('');
	return parseOperation({ ...input, version: 1, requestId });
}
function validateMethod(method: string) {
	methodSchema.parse(method);
	if (
		/^(wallet|chain)\./.test(method) &&
		!Object.values(operationMethods).includes(method as never)
	)
		fail('UNSUPPORTED_OPERATION');
}
export interface OperationContext {
	/** Supplied by the host's authenticated transport, never taken from request metadata. */
	readonly origin: string;
	readonly signal: AbortSignal;
}
export type OperationHandler = (
	request: ConnectOperation,
	context: OperationContext,
) => Promise<JsonValue> | JsonValue;
/** Chain-specific validators must check the complete payload before approval or execution. */
export interface OperationChainAdapter {
	readonly capabilities: readonly OperationCapability[];
	validateAccount(account: Account): boolean | Promise<boolean>;
	validateOperation(request: ConnectOperation): void | Promise<void>;
	/** Optional message preparation; this must not sign or access keys. */
	prepareMessage?(request: ConnectOperation): JsonValue | Promise<JsonValue>;
	normalizeResult?(request: ConnectOperation, result: JsonValue): JsonValue;
	/** Return a safe protocol code, never exception text or internal state. */
	translateError?(error: unknown): OperationErrorCode | undefined;
	readonly handlers: Readonly<Record<string, OperationHandler>>;
}
export interface OperationDispatcherOptions {
	readonly adapters: readonly OperationChainAdapter[];
	/** Required for every wallet.* and custom operation, including getAccounts. */
	readonly approve?: (
		request: ConnectOperation,
		context: OperationContext,
		preparedMessage?: JsonValue,
	) => boolean | Promise<boolean>;
	/** Existing providers can be reused without invoking their authentication signers. */
	readonly accounts?: AccountProvider;
	readonly timeoutMs?: number;
	/** One dispatcher per authenticated session. Never evicts replay records. */
	readonly maxRequests?: number;
}
export class OperationDispatcher {
	readonly capabilities: readonly OperationCapability[];
	private readonly adapters = new Map<string, OperationChainAdapter>();
	private readonly handled = new Set<string>();
	private readonly timeoutMs: number;
	private readonly maxRequests: number;
	private readonly approve: OperationDispatcherOptions['approve'];
	private readonly accounts: AccountProvider | undefined;
	constructor(options: OperationDispatcherOptions) {
		this.timeoutMs = options.timeoutMs ?? 30000;
		this.maxRequests = options.maxRequests ?? 4096;
		if (
			!Number.isSafeInteger(this.timeoutMs) ||
			this.timeoutMs <= 0 ||
			!Number.isSafeInteger(this.maxRequests) ||
			this.maxRequests <= 0
		)
			fail();
		this.approve = options.approve;
		this.accounts = options.accounts;
		const capabilities: OperationCapability[] = [];
		for (const adapter of options.adapters) {
			const caps = parseCapabilities(adapter.capabilities);
			const handlers = Object.freeze({ ...adapter.handlers });
			for (const c of caps) {
				for (const method of c.methods) {
					if (typeof handlers[method] !== 'function')
						fail('UNSUPPORTED_OPERATION');
				}
				const key = `${c.namespace}:${c.reference}`;
				if (this.adapters.has(key)) fail();
				this.adapters.set(
					key,
					Object.freeze({
						capabilities: caps,
						handlers,
						validateAccount: adapter.validateAccount.bind(adapter),
						validateOperation: adapter.validateOperation.bind(adapter),
						prepareMessage: adapter.prepareMessage?.bind(adapter),
						normalizeResult: adapter.normalizeResult?.bind(adapter),
						translateError: adapter.translateError?.bind(adapter),
					}),
				);
				capabilities.push(c);
			}
		}
		this.capabilities = parseCapabilities(capabilities);
	}
	supports(chain: OperationChain, method: string): boolean {
		return supportsOperation(this.capabilities, chain, method);
	}
	async dispatch(input: unknown, origin: string): Promise<OperationResponse> {
		let request: ConnectOperation;
		try {
			request = parseOperation(input);
		} catch (error) {
			let requestId: string | null = null;
			try {
				const value = inputJson(input) as JsonObject;
				if (idSchema.safeParse(value?.requestId).success)
					requestId = value.requestId as string;
			} catch {
				/* No usable identifier. */
			}
			return this.failure(
				requestId,
				error instanceof OperationError ? error.code : 'INVALID_PARAMS',
			);
		}
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<OperationResponse>((resolve) => {
			timer = setTimeout(() => {
				controller.abort();
				resolve(this.failure(request.requestId, 'TIMEOUT'));
			}, this.timeoutMs);
		});
		try {
			return await Promise.race([
				this.execute(request, origin, controller),
				deadline,
			]);
		} finally {
			clearTimeout(timer);
			controller.abort();
		}
	}
	async dispatchJson(input: string, origin: string): Promise<string> {
		return serializeOperationResponse(await this.dispatch(input, origin));
	}
	private failure(
		requestId: string | null,
		code: OperationErrorCode,
	): ConnectOperationFailure {
		return frozen({
			version: 1,
			requestId,
			error: { code, message: operationErrorMessages[code] },
		});
	}
	private async execute(
		request: ConnectOperation,
		origin: string,
		controller: AbortController,
	): Promise<OperationResponse> {
		let adapter: OperationChainAdapter | undefined;
		let stage: OperationErrorCode = 'INVALID_PARAMS';
		const alive = () => {
			if (controller.signal.aborted) fail('TIMEOUT');
		};
		try {
			try {
				origin = validateOrigin(origin);
			} catch {
				fail('UNAUTHORIZED');
			}
			if (
				this.handled.has(request.requestId) ||
				this.handled.size >= this.maxRequests
			)
				fail('UNAUTHORIZED');
			this.handled.add(request.requestId);
			adapter = this.adapters.get(
				`${request.chain.namespace}:${request.chain.reference}`,
			);
			if (!adapter) fail('UNSUPPORTED_CHAIN');
			if (!this.supports(request.chain, request.operation))
				fail('UNSUPPORTED_OPERATION');
			const wallet = request.operation.startsWith('wallet.');
			const signing = /^wallet\.(sign|send)/.test(request.operation);
			if (signing && !request.account) fail('UNSUPPORTED_ACCOUNT');
			const checkAccount = async () => {
				if (!request.account) return;
				if (!(await adapter!.validateAccount(request.account)))
					fail('UNSUPPORTED_ACCOUNT');
				if (wallet) {
					if (!this.accounts) fail('UNSUPPORTED_ACCOUNT');
					const accounts = await this.accounts.getAccounts();
					if (
						!accounts.some(
							(a) =>
								a.account.namespace === request.chain.namespace &&
								a.account.reference === request.chain.reference &&
								a.account.address === request.account!.address,
						)
					)
						fail('UNSUPPORTED_ACCOUNT');
				}
			};
			await checkAccount();
			alive();
			await adapter.validateOperation(request);
			alive();
			const context = Object.freeze({ origin, signal: controller.signal });
			if (!request.operation.startsWith('chain.')) {
				stage = 'UNAUTHORIZED';
				if (!this.approve) fail('UNAUTHORIZED');
				const prepared =
					request.operation === operationMethods.signMessage &&
					adapter.prepareMessage
						? frozen(await adapter.prepareMessage(request))
						: undefined;
				alive();
				if ((await this.approve(request, context, prepared)) !== true)
					fail('USER_REJECTED');
				alive();
				await checkAccount();
				alive();
			}
			stage =
				request.operation === operationMethods.sendTransaction
					? 'BROADCAST_FAILED'
					: signing
						? 'SIGNING_FAILED'
						: request.operation.startsWith('chain.')
							? 'CHAIN_UNAVAILABLE'
							: 'INTERNAL_ERROR';
			const result = await adapter.handlers[request.operation](
				request,
				context,
			);
			alive();
			stage = 'INTERNAL_ERROR';
			return parseOperationResponse({
				version: 1,
				requestId: request.requestId,
				result: adapter.normalizeResult
					? adapter.normalizeResult(request, result)
					: result,
			});
		} catch (error) {
			let code = error instanceof OperationError ? error.code : stage;
			if (!(error instanceof OperationError) && adapter?.translateError) {
				try {
					const translated = adapter.translateError(error);
					if (translated && codes.includes(translated)) code = translated;
				} catch {
					/* Keep safe fallback. */
				}
			}
			return this.failure(
				request.requestId,
				codes.includes(code) ? code : 'INTERNAL_ERROR',
			);
		}
	}
}
/** Read identities from existing authentication accounts; never invoke sign(). */
export function operationAccounts(
	provider: AccountProvider,
	chain: OperationChain,
): OperationHandler {
	return async () =>
		(await provider.getAccounts())
			.filter(
				(a) =>
					a.account.namespace === chain.namespace &&
					a.account.reference === chain.reference,
			)
			.map((a) => accountSchema.parse(a.account));
}
/** Transport inversion: HTTPS, extension messaging, BLE and QR hosts exchange the same JSON. */
export interface OperationTransport {
	exchange(request: string): Promise<string>;
}
export async function requestOperation(
	transport: OperationTransport,
	request: ConnectOperation,
): Promise<OperationResponse> {
	const r = parseOperation(request);
	return parseOperationResponse(
		await transport.exchange(serializeOperation(r)),
		r.requestId,
	);
}

/** Optional payload typings, not universal transaction schemas or validators. */
export interface EvmTransactionParams extends JsonObject {
	readonly transaction: JsonObject;
}
export interface PsbtParams extends JsonObject {
	readonly psbt: string;
	readonly encoding: 'base64' | 'hex';
}
export interface SolanaTransactionParams extends JsonObject {
	readonly transaction: string;
	readonly encoding: 'base64';
}
export interface CoreTransactionParams extends JsonObject {
	readonly transaction: JsonObject;
}
