import { contractRequest, decodeWalletContract } from './abi.js';
import type { Blockchain } from '../providers.js';
import { InvalidTransactionError, UnsupportedMethodError } from './errors.js';
import { requestObject, messageBytes, quantity } from './chain-utils.js';
import type { WalletHandler, WalletMethod } from './types.js';
/** Compatibility translations are installed only when their exact native functions exist. */
export function extendNativeActions(
	blockchain: Blockchain,
	h: Partial<Record<WalletMethod, WalletHandler>>,
	has: (name: string) => boolean,
	call: (name: string, ...args: unknown[]) => Promise<unknown>,
	property: (name: string) => unknown,
): void {
	if (blockchain === 'core') {
		if (has('getCode'))
			h.getCode = (input, o) =>
				call(
					'getCode',
					typeof input === 'string'
						? input
						: (requestObject(input).address ?? o.address ?? o.account),
					o.blockTag ?? 'latest',
				);
		if (has('getStorage'))
			h.getStorage = (input, o) => {
				const r = requestObject(input),
					position = quantity(r.position);
				if (position >= 1n << 256n)
					throw new InvalidTransactionError(
						'Storage position exceeds 256 bits.',
					);
				return call(
					'getStorage',
					r.address ?? o.address ?? o.account,
					position,
					o.blockTag ?? 'latest',
				);
			};
		if (has('getBalance'))
			h.getBalance = (input, o) => {
				const target =
					typeof input === 'string'
						? input
						: input && typeof input === 'object'
							? requestObject(input).address
							: (o.address ?? o.account);
				return target === undefined
					? call('getBalance')
					: call('getBalance', target, o.blockTag ?? 'latest');
			};
		if (has('getTransactionCount') && !h.getNonce)
			h.getNonce = (input, o) =>
				call(
					'getTransactionCount',
					input ?? o.address ?? o.account,
					o.blockTag ?? 'pending',
				);
		if (has('call') && !h.callContract)
			h.callContract = (input, o) =>
				call('call', contractRequest(input, 'core'), o.blockTag ?? 'latest');
		if (h.callContract && !h.readContract)
			h.readContract = async (input, o) => {
				const r = requestObject(input);
				const data = await h.callContract!(input, o);
				return r.abi ? decodeWalletContract({ ...r, data }, 'core') : data;
			};
		if (has('getLogs') && !h.getContractEvents)
			h.getContractEvents = (input) => call('getLogs', input);
		if (has('broadcastTransaction') && !h.sendRawTransaction)
			h.sendRawTransaction = (input) => call('broadcastTransaction', input);
	}
	if (['bitcoin', 'litecoin'].includes(blockchain)) {
		if (has('getChain')) h.getNetwork = () => call('getChain');
		if (!h.switchNetwork && has('switchChain'))
			h.switchNetwork = (input) =>
				call(
					'switchChain',
					typeof input === 'string' ? input : requestObject(input).chain,
				);
		if (has('signMessage'))
			h.signMessage = (input) => {
				if (typeof input === 'string') return call('signMessage', input);
				const r = requestObject(input);
				if (typeof r.message !== 'string')
					throw new InvalidTransactionError('UTXO message must be a string.');
				return call(
					'signMessage',
					r.message,
					...(r.type !== undefined ? [r.type] : []),
				);
			};
		if (has('signPsbt'))
			h.signPSBT = (input) => {
				if (typeof input === 'string') return call('signPsbt', input);
				const r = requestObject(input);
				if (typeof r.psbt !== 'string')
					throw new InvalidTransactionError('Expected a native PSBT string.');
				return call(
					'signPsbt',
					r.psbt,
					...(r.options !== undefined ? [r.options] : []),
				);
			};
		if (has('signPsbts'))
			h.signPSBTs = (input) => {
				if (Array.isArray(input)) return call('signPsbts', input);
				const r = requestObject(input);
				if (!Array.isArray(r.psbts))
					throw new InvalidTransactionError('Expected native PSBT strings.');
				return call(
					'signPsbts',
					r.psbts,
					...(r.options !== undefined ? [r.options] : []),
				);
			};
		const send = blockchain === 'bitcoin' ? 'sendBitcoin' : 'sendLitecoin';
		if (has(send)) {
			const handler: WalletHandler = (input) => {
				const r = requestObject(input);
				const amount = quantity(r.amount);
				if (
					typeof r.to !== 'string' ||
					amount > BigInt(Number.MAX_SAFE_INTEGER)
				)
					throw new InvalidTransactionError(
						'Expected destination and a safe integer amount in native base units.',
					);
				return call(
					send,
					r.to,
					Number(amount),
					...(r.options !== undefined ? [r.options] : []),
				);
			};
			h.transfer ??= handler;
			h.sendTransaction ??= handler;
		}
	}
	if (blockchain === 'aptos') {
		if (has('changeNetwork') && !h.switchNetwork)
			h.switchNetwork = (input) => call('changeNetwork', input);
		if (has('signAndSubmitTransaction')) {
			h.signAndSendTransaction = (input) =>
				call('signAndSubmitTransaction', input);
			h.sendTransaction ??= h.signAndSendTransaction;
		}
		if (has('account') && !h.getPublicKey)
			h.getPublicKey = async () => {
				const r = requestObject(await call('account'));
				if (r.publicKey === undefined)
					throw new UnsupportedMethodError(
						'Wallet does not expose a public key.',
					);
				return r.publicKey;
			};
	}
	if (blockchain === 'near') {
		if (has('signAndSendTransaction')) {
			h.signAndSendTransaction = (input) =>
				call('signAndSendTransaction', input);
			h.sendTransaction ??= h.signAndSendTransaction;
		}
		// A NEAR wallet's batch broadcast must never become a sign-only action.
	}
	if (blockchain === 'monero') {
		if (has('getPrimaryAddress'))
			h.getAddress = () => call('getPrimaryAddress');
		if (has('getPublicSpendKey'))
			h.getPublicKey = () => call('getPublicSpendKey');
		if (has('getNetworkType') && !h.getNetwork)
			h.getNetwork = () => call('getNetworkType');
		if (has('relayTx') && !h.sendRawTransaction)
			h.sendRawTransaction = (input) => {
				if (typeof input !== 'string' || !input)
					throw new InvalidTransactionError(
						'Expected native Monero transaction metadata.',
					);
				return call('relayTx', input);
			};
		if (has('signMessage'))
			h.signMessage = (input) => {
				if (typeof input === 'string') return call('signMessage', input);
				const r = requestObject(input);
				if (typeof r.message !== 'string')
					throw new InvalidTransactionError('Monero message must be a string.');
				return call(
					'signMessage',
					r.message,
					r.signatureType,
					r.accountIndex,
					r.subaddressIndex,
				);
			};
	}
	if (blockchain === 'solana') {
		if (has('signAndSendTransaction'))
			h.signAndSendTransaction = (input, o) =>
				call(
					'signAndSendTransaction',
					input,
					...(o.nativeOptions ? [o.nativeOptions] : []),
				);
		if (has('signMessage'))
			h.signMessage = (input) => call('signMessage', messageBytes(input));
		if (has('signAllTransactions'))
			h.signTransactions = (input) => {
				if (!Array.isArray(input) || input.length === 0)
					throw new InvalidTransactionError('Expected native transactions.');
				return call('signAllTransactions', input);
			};
		// Do not require a network read API merely to pass a native transaction instance.
	}
	if (blockchain === 'ton') {
		if (has('connect'))
			h.connect = (input) =>
				property('account')
					? Promise.resolve({ account: property('account') })
					: input === undefined
						? call('connect')
						: call('connect', input);
	}
	if (h.signTransaction && !h.signTransactions)
		h.signTransactions = async (input, o) => {
			if (!Array.isArray(input) || input.length === 0)
				throw new InvalidTransactionError('Expected transactions.');
			const output = [];
			for (const tx of input) output.push(await h.signTransaction!(tx, o));
			return output;
		};
	if (h.getAccounts && !h.getAddresses) h.getAddresses = h.getAccounts;
}
