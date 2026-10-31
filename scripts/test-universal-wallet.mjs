import assert from 'node:assert/strict';

export async function testUniversalWallet(context) {
	const page = await context.newPage();
	try {
		await page.goto('https://example.com/');
		const result = await page.evaluate(async () => {
			const lib = await import('/dist/browser/index.js');
			const address = '0x' + 'a'.repeat(40);
			const calls = [];
			window.ethereum = {
				async request(args) {
					calls.push(args);
					if (args.method === 'eth_chainId') return '0x1';
					if (
						args.method === 'eth_accounts' ||
						args.method === 'eth_requestAccounts'
					)
						return [address];
					if (args.method === 'eth_sendTransaction') return '0xhash';
					if (args.method === 'personal_sign')
						throw Object.assign(new Error('Rejected'), { code: 4001 });
					return '0x1';
				},
			};
			window.core = {
				connect: async () => ['cbAddress'],
				getAccounts: async () => ['cbAddress'],
				signTransaction: async (tx) => tx,
			};
			const discovery = lib.installWalletProvider({
				standardWallets: false,
				adapterOptions: (blockchain) => ({
					rpcMethods: blockchain === 'ethereum' ? lib.ethereumRpcMethods : [],
				}),
			});
			const api = window.connect;
			if (calls.length) throw new Error('Discovery requested accounts.');
			await api.connect({ blockchain: 'ethereum' });
			const hash = await api.sendTransaction(
				{ to: address, value: '0x1' },
				{ network: '0x1' },
			);
			let rejection;
			try {
				await api.signMessage('hello');
			} catch (error) {
				rejection = error.name;
			}
			await api.connect({ blockchain: 'core' });
			const transaction = Object.assign(Object.create({ type: 'nativeCore' }), {
				body: 'native',
			});
			const signed = await api.signTransaction(transaction, {
				blockchain: 'core',
			});
			const active = api.getConnectedBlockchain();
			const nativeNetwork = await api.request({
				blockchain: 'ethereum',
				method: 'eth_chainId',
			});
			const installed = api === discovery.api;
			discovery.dispose();
			return {
				hash,
				rejection,
				active,
				nativeNetwork,
				installed,
				nativeIdentity: signed === transaction,
				cleaned: window.connect === undefined,
			};
		});
		assert.deepEqual(result, {
			hash: '0xhash',
			rejection: 'UserRejectedRequestError',
			active: 'ethereum',
			nativeNetwork: '0x1',
			installed: true,
			nativeIdentity: true,
			cleaned: true,
		});
	} finally {
		await page.close();
	}
}
