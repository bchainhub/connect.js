import {
	ConnectError,
	canonicalBytes,
	compatible,
	parseConnectUri,
	validateChallenge,
	validateOrigin,
	idSchema,
	type Challenge,
	type ConnectTarget,
	type Proof,
	type Selection,
} from './protocol.js';
export interface WalletAccount extends Selection {
	sign(payload: Uint8Array): Promise<Pick<Proof, 'signature' | 'publicKey'>>;
}
export interface AccountProvider {
	getAccounts(): Promise<readonly WalletAccount[]>;
}
export interface ConnectTransport {
	parse(input: string): ConnectTarget;
}
export class UriTransport implements ConnectTransport {
	constructor(
		private readonly schemes: readonly string[] = ['connect', 'https'],
	) {}
	parse(input: string) {
		return parseConnectUri(input, this.schemes);
	}
}
export interface ConnectNetwork {
	challenge(target: ConnectTarget): Promise<unknown>;
	approve(target: ConnectTarget, proof: Proof): Promise<unknown>;
}
export type RequestState =
	| 'awaitingUserApproval'
	| 'signing'
	| 'submitting'
	| 'approved'
	| 'rejected'
	| 'cancelled'
	| 'expired'
	| 'failed';
export class WalletRequest {
	#state: RequestState = 'awaitingUserApproval';
	get state() {
		return this.#state;
	}
	readonly accounts: readonly WalletAccount[];
	constructor(
		readonly challenge: Challenge,
		accounts: readonly WalletAccount[],
		private readonly network: ConnectNetwork,
		private readonly now: () => number,
		private readonly changed: (r: WalletRequest) => void,
	) {
		this.accounts = Object.freeze(
			accounts
				.filter((a) => compatible(challenge, a))
				.map((a) =>
					Object.freeze({
						...a,
						account: Object.freeze({ ...a.account }),
						sign: a.sign.bind(a),
					}),
				),
		);
	}
	private set(state: RequestState) {
		this.#state = state;
		this.changed(this);
	}
	private pending() {
		if (this.state !== 'awaitingUserApproval')
			throw new ConnectError('invalidState');
	}
	cancel() {
		if (this.state !== 'awaitingUserApproval' && this.state !== 'signing')
			throw new ConnectError('invalidState');
		this.set('cancelled');
	}
	reject() {
		this.pending();
		this.set('rejected');
	}
	async approve(account: WalletAccount): Promise<void> {
		this.pending();
		if (!this.accounts.includes(account))
			throw new ConnectError('noCompatibleAccount');
		try {
			validateChallenge(this.challenge, undefined, this.now());
			this.set('signing');
			const signature = await account.sign(
				canonicalBytes(this.challenge, account),
			);
			if ((this.state as RequestState) === 'cancelled')
				throw new ConnectError('cancelled');
			validateChallenge(this.challenge, undefined, this.now());
			this.set('submitting');
			const result = await this.network.approve(this.challenge, {
				requestId: this.challenge.requestId,
				account: account.account,
				profile: account.profile,
				alg: account.alg,
				signature: signature.signature,
				...(signature.publicKey === undefined
					? {}
					: { publicKey: signature.publicKey }),
			});
			if (
				!result ||
				typeof result !== 'object' ||
				!('status' in result) ||
				result.status !== 'APPROVED' ||
				!('requestId' in result) ||
				result.requestId !== this.challenge.requestId
			)
				throw new ConnectError('serverRejected');
			this.set('approved');
		} catch (e) {
			if ((this.state as RequestState) !== 'cancelled')
				this.set(
					e instanceof ConnectError && e.code === 'expiredRequest'
						? 'expired'
						: 'failed',
				);
			throw e instanceof ConnectError ? e : new ConnectError('signingFailed');
		}
	}
}
export class ConnectClient {
	private readonly handled = new Set<string>();
	readonly listeners = new Set<(r: WalletRequest) => void>();
	constructor(
		private readonly provider: AccountProvider,
		private readonly network: ConnectNetwork,
		private readonly transport: ConnectTransport = new UriTransport(),
		private readonly now: () => number = Date.now,
	) {}
	async resolve(input: string): Promise<WalletRequest> {
		return this.resolveTarget(this.transport.parse(input));
	}
	async resolveTarget(input: ConnectTarget): Promise<WalletRequest> {
		const target = Object.freeze({
			origin: validateOrigin(input.origin),
			requestId: idSchema.parse(input.requestId),
		});
		const key = `${target.origin}/${target.requestId}`;
		if (this.handled.has(key)) throw new ConnectError('replayedRequest');
		this.handled.add(key);
		try {
			const challenge = validateChallenge(
				await this.network.challenge(target),
				target,
				this.now(),
			);
			const request = new WalletRequest(
				challenge,
				await this.provider.getAccounts(),
				this.network,
				this.now,
				(r) => {
					for (const fn of this.listeners) {
						try {
							fn(r);
						} catch {
							/* Observers cannot change protocol execution. */
						}
					}
				},
			);
			if (!request.accounts.length)
				throw new ConnectError('noCompatibleAccount');
			for (const fn of this.listeners) {
				try {
					fn(request);
				} catch {
					/* Isolated observer. */
				}
			}
			return request;
		} catch (e) {
			this.handled.delete(key);
			throw e;
		}
	}
}
