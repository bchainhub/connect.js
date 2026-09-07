import { getAddress } from 'viem';
import { ConnectError } from '../protocol.js';
import { walletAccount, type ChainDefinition } from '../chains.js';
import type { AccountProvider } from '../wallet.js';
export interface Eip1193Provider {
	request(args: {
		method: string;
		params?: readonly unknown[] | object;
	}): Promise<unknown>;
}
/** Use eth_requestAccounts only from an explicit connect-button interaction. */
export async function requestEthereumAccounts(
	provider: Eip1193Provider,
): Promise<readonly string[]> {
	return addresses(await provider.request({ method: 'eth_requestAccounts' }));
}
function addresses(input: unknown): readonly string[] {
	if (!Array.isArray(input) || !input.every((a) => typeof a === 'string'))
		throw new ConnectError('invalidAccount');
	try {
		return input.map((a) => getAddress(a));
	} catch {
		throw new ConnectError('invalidAccount');
	}
}
/** MetaMask and other EIP-1193 providers. Discovery never prompts or signs.
 * The host calls ConnectClient.resolve, renders confirmation, then approve. */
export function ethereumAccountProvider(
	provider: Eip1193Provider,
	chain: ChainDefinition,
): AccountProvider {
	chain = Object.freeze({ ...chain });
	if (
		chain.namespace !== 'eip155' ||
		chain.profile !== 'ethereum-siwe' ||
		chain.alg !== null ||
		!/^[1-9][0-9]{0,14}$/.test(chain.reference)
	)
		throw new ConnectError('invalidConfiguration');
	async function current() {
		const network = await provider.request({ method: 'eth_chainId' });
		if (
			typeof network !== 'string' ||
			!/^0x[0-9a-fA-F]+$/.test(network) ||
			BigInt(network).toString() !== chain.reference
		)
			throw new ConnectError('networkMismatch');
		return addresses(await provider.request({ method: 'eth_accounts' }));
	}
	return {
		async getAccounts() {
			return (await current()).map((address) =>
				walletAccount(chain, address, async (bytes) => {
					if (!(await current()).includes(address))
						throw new ConnectError('accountChanged');
					const payload =
						'0x' +
						Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
					const signature = await provider.request({
						method: 'personal_sign',
						params: [payload, address],
					});
					if (!(await current()).includes(address))
						throw new ConnectError('accountChanged');
					if (
						typeof signature !== 'string' ||
						!/^0x[0-9a-fA-F]{130}$/.test(signature)
					)
						throw new ConnectError('malformedProof');
					return { signature: signature.toLowerCase() };
				}),
			);
		},
	};
}
