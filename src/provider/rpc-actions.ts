import { verifyMessage as verifyEthereumMessage, type Hex } from 'viem';
import { ed448 } from '@noble/curves/ed448.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import {
	InvalidTransactionError,
	UnsupportedMethodError,
	WalletNotConnectedError,
	TransactionFailedError,
	ProviderDisconnectedError,
} from './errors.js';
import {
	requestObject,
	quantity,
	hexQuantity,
	messageBytes,
	hexBytes,
	validateAddress,
	coreAddressValid,
} from './chain-utils.js';
import {
	encodeWalletContract,
	decodeWalletContract,
	contractRequest,
	encodeDeployment,
} from './abi.js';
import type {
	WalletCallOptions,
	WalletHandler,
	WalletMethod,
} from './types.js';
export const coreRpcMethods = Object.freeze([
	'xcb_requestAccounts',
	'xcb_accounts',
	'xcb_networkId',
	'xcb_getBalance',
	'xcb_getCode',
	'xcb_getStorageAt',
	'xcb_sendTransaction',
	'xcb_signTransaction',
	'personal_sign',
	'xcb_sign',
	'xcb_signTypedData_v4',
	'xcb_call',
	'xcb_estimateEnergy',
	'xcb_energyPrice',
	'xcb_blockNumber',
	'xcb_getBlockByNumber',
	'xcb_getBlockByHash',
	'xcb_getTransactionByHash',
	'xcb_getTransactionReceipt',
	'xcb_getTransactionCount',
	'xcb_sendRawTransaction',
	'xcb_getLogs',
]);
export const additionalEthereumRpcMethods = Object.freeze([
	'eth_signTransaction',
	'eth_getCode',
	'eth_getStorageAt',
	'eth_getBlockByHash',
	'eth_feeHistory',
	'eth_maxPriorityFeePerGas',
]);
const tokenAbi = (
	name: string,
	inputs: readonly string[],
	outputs: readonly string[],
) => [
	{
		type: 'function',
		name,
		stateMutability: 'nonpayable',
		inputs: inputs.map((type, i) => ({ name: `arg${i}`, type })),
		outputs: outputs.map((type) => ({ type })),
	},
];

export function rpcWalletActions(config: {
	blockchain: 'ethereum' | 'core';
	methods: ReadonlySet<string>;
	request: (method: string, params?: unknown) => Promise<unknown>;
	disposed: () => boolean;
	emit: (event: 'transactionStatusChanged', value: unknown) => void;
}): Partial<Record<WalletMethod, WalletHandler>> {
	const { blockchain, methods, request } = config;
	const core = blockchain === 'core';
	const prefix = core ? 'xcb' : 'eth';
	const h: Partial<Record<WalletMethod, WalletHandler>> = {};
	const account = (o: WalletCallOptions) => {
		if (!o.account)
			throw new WalletNotConnectedError('Select an authorized account.');
		const address = validateAddress(
			o.account,
			blockchain,
			core ? o.network : undefined,
		);
		if (core && /^0{43}[0-9]$/.test(address))
			throw new InvalidTransactionError('A system address cannot sign.');
		return address;
	};
	const address = (input: unknown, o: WalletCallOptions) =>
		validateAddress(
			typeof input === 'string'
				? input
				: input && typeof input === 'object'
					? (requestObject(input).address ?? o.address ?? o.account)
					: (o.address ?? o.account),
			blockchain,
		);
	const tx = (input: unknown, o: WalletCallOptions) => {
		const result = { ...requestObject(input) };
		const alias = core ? 'energyLimit' : 'gasLimit',
			units = core ? 'energy' : 'gas';
		if (result[alias] !== undefined) {
			if (
				result[units] !== undefined &&
				quantity(result[units]) !== quantity(result[alias])
			)
				throw new InvalidTransactionError(
					'Conflicting transaction resource limits.',
				);
			result[units] = result[alias];
			delete result[alias];
		}
		if (result.from !== undefined) {
			result.from = validateAddress(
				result.from,
				blockchain,
				core ? (o.network ?? result.networkId) : undefined,
			);
			if (core && /^0{43}[0-9]$/.test(result.from as string))
				throw new InvalidTransactionError(
					'A system address cannot be a transaction sender.',
				);
		} else if (o.account) result.from = account(o);
		if (core && result.from !== undefined)
			validateAddress(result.from, 'core', o.network ?? result.networkId);
		if (result.to !== undefined)
			result.to = validateAddress(
				result.to,
				blockchain,
				core ? (o.network ?? result.networkId) : undefined,
			);
		if (
			result.from !== undefined &&
			o.account &&
			String(result.from).toLowerCase() !==
				validateAddress(
					o.account,
					blockchain,
					core ? o.network : undefined,
				).toLowerCase()
		)
			throw new InvalidTransactionError(
				'Transaction sender differs from the selected account.',
			);
		if (
			core &&
			[
				'gas',
				'gasPrice',
				'maxFeePerGas',
				'maxPriorityFeePerGas',
				'chainId',
			].some((k) => result[k] !== undefined)
		)
			throw new InvalidTransactionError(
				'Core transactions use energy, energyPrice and networkId, not EVM gas/chainId fields.',
			);
		for (const key of core
			? ['value', 'energy', 'energyPrice', 'nonce', 'networkId', 'type']
			: [
					'value',
					'gas',
					'gasPrice',
					'maxFeePerGas',
					'maxPriorityFeePerGas',
					'nonce',
					'chainId',
					'type',
					'maxFeePerBlobGas',
				])
			if (result[key] !== undefined) result[key] = hexQuantity(result[key]);
		if (
			result.data !== undefined &&
			(typeof result.data !== 'string' ||
				!/^0x(?:[0-9a-f]{2})*$/i.test(result.data))
		)
			throw new InvalidTransactionError('Invalid transaction calldata.');
		if (
			!core &&
			result.gasPrice !== undefined &&
			(result.maxFeePerGas !== undefined ||
				result.maxPriorityFeePerGas !== undefined)
		)
			throw new InvalidTransactionError(
				'Legacy gasPrice cannot be combined with EIP-1559 fee caps.',
			);
		if (
			!core &&
			result.maxFeePerGas !== undefined &&
			result.maxPriorityFeePerGas !== undefined &&
			quantity(result.maxPriorityFeePerGas) > quantity(result.maxFeePerGas)
		)
			throw new InvalidTransactionError(
				'Priority fee cannot exceed the maximum fee cap.',
			);
		return result;
	};
	const bind = (
		method: WalletMethod,
		native: string,
		params: (input: unknown, o: WalletCallOptions) => unknown = () => [],
	) => {
		if (methods.has(native))
			h[method] = (input, o) => request(native, params(input, o));
	};
	bind('connect', `${prefix}_requestAccounts`);
	bind('getAccounts', `${prefix}_accounts`);
	if (h.connect) {
		const connect = h.connect;
		h.connect = async (input, o) => {
			const accounts = await connect(input, o);
			if (!Array.isArray(accounts) || !accounts.length)
				throw new WalletNotConnectedError(
					'Wallet did not authorize any accounts.',
				);
			return accounts;
		};
	}
	bind('getChainId', core ? 'xcb_networkId' : 'eth_chainId');
	if (!h.connect && h.getAccounts)
		h.connect = async () => {
			const accounts = await h.getAccounts!(undefined, {});
			if (!Array.isArray(accounts) || accounts.length === 0)
				throw new WalletNotConnectedError(
					'No already-authorized accounts; declare the wallet account-request RPC or supply a connect handler.',
				);
			return accounts;
		};
	bind('getBalance', `${prefix}_getBalance`, (input, o) => [
		address(input, o),
		o.blockTag ?? 'latest',
	]);
	bind('getCode', `${prefix}_getCode`, (input, o) => [
		address(input, o),
		o.blockTag ?? 'latest',
	]);
	bind('getStorage', `${prefix}_getStorageAt`, (input, o) => {
		const r = requestObject(input);
		const position = quantity(r.position);
		if (position >= 1n << 256n)
			throw new InvalidTransactionError('Storage position exceeds 256 bits.');
		return [address(r, o), hexQuantity(position), o.blockTag ?? 'latest'];
	});
	bind('getNonce', `${prefix}_getTransactionCount`, (input, o) => [
		address(input, o),
		o.blockTag ?? 'pending',
	]);
	bind('sendTransaction', `${prefix}_sendTransaction`, (input, o) => [
		tx(input, o),
	]);
	bind('signTransaction', `${prefix}_signTransaction`, (input, o) => [
		tx(input, o),
	]);
	if (h.signTransaction)
		h.signTransactions = async (input, o) => {
			if (!Array.isArray(input) || input.length === 0)
				throw new InvalidTransactionError('Expected transactions.');
			const output = [];
			for (const item of input) output.push(await h.signTransaction!(item, o));
			return output;
		};
	if (h.sendTransaction) h.signAndSendTransaction = h.sendTransaction;
	if (methods.has('personal_sign'))
		h.signMessage = (input, o) =>
			request('personal_sign', [hexBytes(messageBytes(input)), account(o)]);
	else if (core && methods.has('xcb_sign'))
		h.signMessage = (input, o) =>
			request('xcb_sign', [account(o), hexBytes(messageBytes(input))]);
	bind('signTypedData', `${prefix}_signTypedData_v4`, (input, o) => {
		let data: Record<string, unknown>;
		try {
			data = requestObject(
				typeof input === 'string' ? JSON.parse(input) : input,
			);
		} catch {
			throw new InvalidTransactionError('Expected typed data.');
		}
		const domain = requestObject(data.domain ?? {});
		if (core) {
			if (domain.chainId !== undefined || domain.networkId === undefined)
				throw new InvalidTransactionError(
					'CIP-712 requires domain.networkId, not chainId.',
				);
			if (domain.verifyingContract !== undefined)
				validateAddress(domain.verifyingContract, 'core', domain.networkId);
		}
		return [
			account(o),
			JSON.stringify(data, (_, v) =>
				typeof v === 'bigint' ? v.toString() : v,
			),
		];
	});
	bind('getBlockNumber', `${prefix}_blockNumber`);
	bind('getGasPrice', core ? 'xcb_energyPrice' : 'eth_gasPrice');
	if (
		methods.has(`${prefix}_getBlockByNumber`) ||
		methods.has(`${prefix}_getBlockByHash`)
	)
		h.getBlock = (input) => {
			const r = input && typeof input === 'object' ? requestObject(input) : {};
			const value = r.hash ?? r.number ?? input ?? 'latest';
			const hash =
				r.hash !== undefined ||
				(typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value));
			const native = `${prefix}_getBlockBy${hash ? 'Hash' : 'Number'}`;
			if (!methods.has(native))
				throw new UnsupportedMethodError('Block query mode is not declared.');
			return request(native, [
				typeof value === 'number' || typeof value === 'bigint'
					? hexQuantity(value)
					: value,
				r.includeTransactions === true,
			]);
		};
	const hash = (input: unknown) =>
		typeof input === 'string' ? input : requestObject(input).hash;
	bind('getTransaction', `${prefix}_getTransactionByHash`, (input) => [
		hash(input),
	]);
	bind('getTransactionReceipt', `${prefix}_getTransactionReceipt`, (input) => [
		hash(input),
	]);
	bind('sendRawTransaction', `${prefix}_sendRawTransaction`, (input) => {
		if (typeof input !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(input))
			throw new InvalidTransactionError('Expected signed transaction hex.');
		return [input];
	});
	bind(
		'estimateGas',
		core ? 'xcb_estimateEnergy' : 'eth_estimateGas',
		(input, o) => [tx(input, o)],
	);
	bind('getContractEvents', `${prefix}_getLogs`, (input) => [
		requestObject(input),
	]);
	if (!core) {
		bind('switchNetwork', 'wallet_switchEthereumChain', (input) => [
			{
				chainId: hexQuantity(
					typeof input === 'object' && input
						? requestObject(input).chainId
						: input,
				),
			},
		]);
		bind('addNetwork', 'wallet_addEthereumChain', (input) => {
			const r = requestObject(input);
			r.chainId = hexQuantity(r.chainId);
			return [r];
		});
		bind('watchAsset', 'wallet_watchAsset', (input) => requestObject(input));
		if (h.watchAsset) h.addToken = h.watchAsset;
	}
	h.encodeContractCall = (input) => encodeWalletContract(input, blockchain);
	h.decodeContractResult = (input) => decodeWalletContract(input, blockchain);
	if (methods.has(`${prefix}_call`)) {
		h.callContract = (input, o) =>
			request(`${prefix}_call`, [
				tx(contractRequest(input, blockchain), o),
				o.blockTag ?? 'latest',
			]);
		h.readContract = async (input, o) => {
			const r = requestObject(input);
			const data = await h.callContract!(input, o);
			return r.abi ? decodeWalletContract({ ...r, data }, blockchain) : data;
		};
		h.simulateTransaction = (input, o) =>
			request(`${prefix}_call`, [tx(input, o), o.blockTag ?? 'latest']);
	}
	if (h.sendTransaction) {
		h.sendContractTransaction = (input, o) =>
			h.sendTransaction!(contractRequest(input, blockchain), o);
		h.writeContract = h.sendContractTransaction;
		h.deployContract = (input, o) =>
			h.sendTransaction!(encodeDeployment(input, blockchain), o);
		h.transfer = (input, o) => {
			const r = requestObject(input);
			return h.sendTransaction!(
				{
					to: validateAddress(r.to, blockchain),
					value: hexQuantity(r.amount ?? r.value),
				},
				o,
			);
		};
	}
	if (h.estimateGas)
		h.estimateContractGas = (input, o) =>
			h.estimateGas!(contractRequest(input, blockchain), o);
	if (h.estimateGas && h.getGasPrice) {
		h.estimateFee = async (input, o) => {
			const r = tx(input, o);
			if (r.maxPriorityFeePerGas !== undefined && r.maxFeePerGas === undefined)
				throw new InvalidTransactionError(
					'Supply maxFeePerGas when estimating a priority-fee transaction.',
				);
			const units = quantity(await h.estimateGas!(r, o));
			const price = quantity(
				r.maxFeePerGas ??
					r.energyPrice ??
					r.gasPrice ??
					(await h.getGasPrice!(undefined, o)),
			);
			return {
				units: hexQuantity(units),
				price: hexQuantity(price),
				total: hexQuantity(units * price),
				unit: 'native-base-units',
				isUpperBound: r.maxFeePerGas !== undefined,
			};
		};
		h.estimateTransactionFee = h.estimateFee;
	}
	if (h.getNonce || h.estimateGas)
		h.prepareTransaction = async (input, o) => {
			const r = tx(input, o);
			if (r.nonce === undefined && h.getNonce)
				r.nonce = await h.getNonce!(r.from, o);
			const units = core ? 'energy' : 'gas';
			if (r[units] === undefined && h.estimateGas)
				r[units] = await h.estimateGas!(r, o);
			const price = core ? 'energyPrice' : 'gasPrice';
			if (
				r[price] === undefined &&
				r.maxFeePerGas === undefined &&
				r.maxPriorityFeePerGas === undefined &&
				h.getGasPrice
			)
				r[price] = await h.getGasPrice!(undefined, o);
			return r;
		};
	if (h.getBalance)
		h.getBalances = async (_, o) => {
			const addresses = o.addresses ?? [o.address ?? account(o)];
			return Promise.all(
				addresses.map(async (target) => ({
					address: target,
					balance: await h.getBalance!(target, o),
				})),
			);
		};
	if (h.getTransactionReceipt) {
		h.getTransactionStatus = async (input, o) => {
			const receipt = await h.getTransactionReceipt!(input, o);
			if (receipt === null)
				return { status: 'pending-or-unknown', receipt: null };
			const r = requestObject(receipt);
			const status =
				r.status === undefined
					? 'mined'
					: quantity(r.status) === 0n
						? 'reverted'
						: 'confirmed';
			const result = { status, receipt };
			config.emit('transactionStatusChanged', result);
			return result;
		};
		h.waitForTransaction = async (input, o) => {
			const r =
				typeof input === 'string' ? { hash: input } : requestObject(input);
			const timeout = Number(r.timeoutMs ?? 30000),
				interval = Number(r.pollIntervalMs ?? 1000);
			const confirmations = quantity(r.confirmations ?? 1);
			if (
				!Number.isFinite(timeout) ||
				timeout <= 0 ||
				timeout > 300000 ||
				!Number.isFinite(interval) ||
				interval <= 0 ||
				confirmations < 1n
			)
				throw new InvalidTransactionError(
					'Invalid transaction polling limits.',
				);
			if (confirmations > 1n && !h.getBlockNumber)
				throw new UnsupportedMethodError(
					'Confirmation counting requires block number RPC.',
				);
			const deadline = Date.now() + timeout;
			while (Date.now() < deadline) {
				if (config.disposed())
					throw new ProviderDisconnectedError(
						'Provider disposed while waiting.',
					);
				const receipt = await h.getTransactionReceipt!(r.hash, o);
				if (receipt !== null) {
					const result = requestObject(receipt);
					if (result.status !== undefined && quantity(result.status) === 0n)
						throw new TransactionFailedError('Transaction reverted.', {
							cause: receipt,
						});
					if (
						confirmations === 1n ||
						(result.blockNumber !== undefined &&
							quantity(await h.getBlockNumber!(undefined, o)) -
								quantity(result.blockNumber) +
								1n >=
								confirmations)
					)
						return receipt;
				}
				await new Promise((resolve) =>
					setTimeout(
						resolve,
						Math.min(interval, Math.max(1, deadline - Date.now())),
					),
				);
			}
			throw new TransactionFailedError('Transaction confirmation timed out.');
		};
	}
	const readToken = (
		input: unknown,
		o: WalletCallOptions,
		name: string,
		types: readonly string[],
		args: readonly unknown[],
		outputs: readonly string[],
	) => {
		const r = requestObject(input);
		return h.readContract!(
			{
				address: validateAddress(r.token ?? r.address, blockchain),
				abi: tokenAbi(name, types, outputs),
				functionName: name,
				args,
			},
			o,
		);
	};
	if (h.readContract) {
		h.getTokenBalance = (input, o) => {
			const r = requestObject(input);
			return readToken(
				r,
				o,
				'balanceOf',
				['address'],
				[validateAddress(r.owner ?? o.address ?? o.account, blockchain)],
				['uint256'],
			);
		};
		h.getTokenAllowance = (input, o) => {
			const r = requestObject(input);
			return readToken(
				r,
				o,
				'allowance',
				['address', 'address'],
				[
					validateAddress(r.owner ?? o.account, blockchain),
					validateAddress(r.spender, blockchain),
				],
				['uint256'],
			);
		};
		h.getTokenMetadata = async (input, o) => {
			const r = requestObject(input);
			const token = validateAddress(r.token ?? r.address, blockchain);
			return {
				address: token,
				name: await readToken(r, o, 'name', [], [], ['string']),
				symbol: await readToken(r, o, 'symbol', [], [], ['string']),
				decimals: Number(
					quantity(await readToken(r, o, 'decimals', [], [], ['uint8'])),
				),
			};
		};
		h.getTokenBalances = async (_, o) => {
			if (!o.tokens?.length)
				throw new InvalidTransactionError('Supply tokens in call options.');
			return Promise.all(
				o.tokens.map(async (token) => ({
					token,
					balance: await h.getTokenBalance!({ token }, o),
				})),
			);
		};
	}
	if (h.sendContractTransaction) {
		const sendToken = (
			r: Record<string, unknown>,
			o: WalletCallOptions,
			name: string,
			types: readonly string[],
			args: readonly unknown[],
		) =>
			h.sendContractTransaction!(
				{
					address: validateAddress(r.token, blockchain),
					abi: tokenAbi(name, types, ['bool']),
					functionName: name,
					args,
				},
				o,
			);
		h.approveToken = (input, o) => {
			const r = requestObject(input);
			return sendToken(
				r,
				o,
				'approve',
				['address', 'uint256'],
				[validateAddress(r.spender, blockchain), quantity(r.amount)],
			);
		};
		h.transferToken = (input, o) => {
			const r = requestObject(input);
			return sendToken(
				r,
				o,
				'transfer',
				['address', 'uint256'],
				[validateAddress(r.to, blockchain), quantity(r.amount)],
			);
		};
		h.transferNFT = (input, o) => {
			const r = requestObject(input);
			const from = validateAddress(r.from ?? o.account, blockchain),
				to = validateAddress(r.to, blockchain);
			if (r.standard === 'erc1155')
				return sendToken(
					r,
					o,
					'safeTransferFrom',
					['address', 'address', 'uint256', 'uint256', 'bytes'],
					[from, to, quantity(r.tokenId), quantity(r.amount), r.data ?? '0x'],
				);
			if (r.standard !== undefined && r.standard !== 'erc721')
				throw new UnsupportedMethodError(
					'Only ERC-721/ERC-1155 compatible token contracts are mapped.',
				);
			return sendToken(
				r,
				o,
				'safeTransferFrom',
				['address', 'address', 'uint256'],
				[from, to, quantity(r.tokenId)],
			);
		};
	}
	h.verifyMessage = async (input) => {
		const r = requestObject(input);
		const bytes = messageBytes(r.message);
		if (!core)
			return verifyEthereumMessage({
				address: validateAddress(r.address, 'ethereum') as Hex,
				message: { raw: bytes },
				signature: r.signature as Hex,
			});
		if (
			!coreAddressValid(r.address) ||
			typeof r.signature !== 'string' ||
			!/^0x[0-9a-f]{342}$/i.test(r.signature)
		)
			return false;
		const sig = Uint8Array.from(r.signature.slice(2).match(/../g)!, (b) =>
			parseInt(b, 16),
		);
		const key = sig.slice(114);
		const digest = sha3_256(
			new Uint8Array([
				...new TextEncoder().encode(
					`\x19Core Signed Message:\n${bytes.length}`,
				),
				...bytes,
			]),
		);
		const body = hexBytes(sha3_256(key).slice(12)).slice(2);
		return (
			validateAddress(r.address, 'core').slice(4).toLowerCase() === body &&
			ed448.verify(sig.slice(0, 114), digest, key)
		);
	};
	return h;
}
