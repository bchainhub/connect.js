import {
	encodeAbiParameters,
	decodeAbiParameters,
	encodeFunctionData,
	decodeFunctionResult,
	type Abi,
	type AbiParameter,
	type Hex,
} from 'viem';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { InvalidTransactionError } from './errors.js';
import { requestObject, validateAddress, hexBytes } from './chain-utils.js';
type Parameter = AbiParameter & {
	name?: string;
	components?: readonly Parameter[];
};
interface FunctionAbi {
	type: string;
	name: string;
	inputs: readonly Parameter[];
	outputs?: readonly Parameter[];
}
function signature(p: Parameter): string {
	return p.type.startsWith('tuple')
		? `(${(p.components ?? []).map(signature).join(',')})${p.type.slice(5)}`
		: p.type
				.replace(/^uint(?=\[|$)/, 'uint256')
				.replace(/^int(?=\[|$)/, 'int256');
}
function entry(r: Record<string, unknown>): FunctionAbi {
	if (!Array.isArray(r.abi) || typeof r.functionName !== 'string')
		throw new InvalidTransactionError('ABI and functionName are required.');
	const matches = (r.abi as FunctionAbi[]).filter(
		(x) =>
			x.type === 'function' &&
			(x.name === r.functionName ||
				`${x.name}(${x.inputs.map(signature).join(',')})` === r.functionName),
	);
	if (matches.length !== 1)
		throw new InvalidTransactionError(
			'Select an unambiguous ABI function, using its full signature for overloads.',
		);
	return matches[0];
}
function translated(p: Parameter): Parameter {
	return {
		...p,
		type: p.type.replace(/^address(?=\[|$)/, 'uint176'),
		...(p.components ? { components: p.components.map(translated) } : {}),
	};
}
function addressValues(p: Parameter, v: unknown, decode = false): unknown {
	const array = p.type.match(/^(.*)\[([0-9]*)\]$/);
	if (array) {
		if (!Array.isArray(v))
			throw new InvalidTransactionError('Expected ABI array.');
		return v.map((x) => addressValues({ ...p, type: array[1] }, x, decode));
	}
	if (p.type === 'address')
		return decode
			? BigInt(v as bigint)
					.toString(16)
					.padStart(44, '0')
			: BigInt('0x' + validateAddress(v, 'core'));
	if (p.type === 'tuple') {
		const components = p.components ?? [];
		const values = Array.isArray(v)
			? v
			: components.map((c) => requestObject(v)[c.name ?? '']);
		return components.map((c, i) => addressValues(c, values[i], decode));
	}
	return v;
}
export function encodeWalletContract(
	input: unknown,
	blockchain: 'ethereum' | 'core',
): `0x${string}` {
	const r = requestObject(input);
	const f = entry(r);
	const args = (r.args ?? []) as readonly unknown[];
	if (!Array.isArray(args) || args.length !== f.inputs.length)
		throw new InvalidTransactionError('Incorrect ABI arguments.');
	if (blockchain === 'ethereum')
		return encodeFunctionData({ abi: [f] as Abi, functionName: f.name, args });
	const selector = hexBytes(
		sha3_256(
			new TextEncoder().encode(
				`${f.name}(${f.inputs.map(signature).join(',')})`,
			),
		).slice(0, 4),
	);
	return (selector +
		encodeAbiParameters(
			f.inputs.map(translated),
			args.map((v, i) => addressValues(f.inputs[i], v)),
		).slice(2)) as Hex;
}
export function decodeWalletContract(
	input: unknown,
	blockchain: 'ethereum' | 'core',
): unknown {
	const r = requestObject(input);
	const f = entry(r);
	if (blockchain === 'ethereum')
		return decodeFunctionResult({
			abi: [f] as Abi,
			functionName: f.name,
			data: r.data as Hex,
		});
	const outputs = f.outputs ?? [];
	const decoded = decodeAbiParameters(
		outputs.map(translated),
		r.data as Hex,
	).map((v, i) => addressValues(outputs[i], v, true));
	return outputs.length === 1 ? decoded[0] : decoded;
}
export function contractRequest(
	input: unknown,
	blockchain: 'ethereum' | 'core',
): Record<string, unknown> {
	const r = requestObject(input);
	const { abi, functionName, args, address, ...transaction } = r;
	return {
		...transaction,
		...(address !== undefined
			? { to: validateAddress(address, blockchain) }
			: {}),
		...(abi
			? { data: encodeWalletContract({ abi, functionName, args }, blockchain) }
			: {}),
	};
}
export function encodeDeployment(
	input: unknown,
	blockchain: 'ethereum' | 'core',
): Record<string, unknown> {
	const r = requestObject(input);
	if (
		typeof r.bytecode !== 'string' ||
		!/^0x(?:[0-9a-f]{2})+$/i.test(r.bytecode)
	)
		throw new InvalidTransactionError('Expected deployment bytecode.');
	const { bytecode, abi, args, ...tx } = r;
	if (tx.to !== undefined)
		throw new InvalidTransactionError('Deployment cannot have a destination.');
	const constructor = Array.isArray(abi)
		? (abi as { type: string; inputs: readonly Parameter[] }[]).find(
				(f) => f.type === 'constructor',
			)
		: undefined;
	const inputs = constructor?.inputs ?? [];
	const values = (args ?? []) as unknown[];
	if (values.length !== inputs.length)
		throw new InvalidTransactionError('Incorrect constructor arguments.');
	const encoded = encodeAbiParameters(
		blockchain === 'core' ? inputs.map(translated) : inputs,
		blockchain === 'core'
			? values.map((v, i) => addressValues(inputs[i], v))
			: values,
	);
	return { ...tx, data: bytecode + encoded.slice(2) };
}
