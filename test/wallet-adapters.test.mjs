import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ed448 } from '@noble/curves/ed448.js';
import { base58, bech32 } from '@scure/base';
import {
	ConnectClient,
	chains,
	allChains,
	canonicalMessage,
} from '../dist/index.js';
import {
	BrowserConnect,
	signBrowserChallenge,
	ProfileRegistry,
} from '../dist/index.js';
import {
	walletAccountProvider,
	coreAccountProvider,
	coreAddress,
	coreChain,
	verifyCoreSignature,
	validateCoreAddress,
	solanaAccountProvider,
	solanaStandardAccountProvider,
	requestStandardAccounts,
	getStandardWallets,
	getSolanaWallets,
	discoverEthereumWallets,
	cardanoAccountProvider,
	bitcoinAccountProvider,
	tronLinkAccountProvider,
	stellarAccountProvider,
	moneroAccountProvider,
	rippleAccountProvider,
	combineWalletProviders,
	bytesToHex,
} from '../dist/wallet/index.js';
const vectors = JSON.parse(
	readFileSync(new URL('./fixtures/conformance.json', import.meta.url)),
);
const find = (profile) => vectors.find((v) => v.proof.profile === profile);
const fixtureSign = (v) => async (address, bytes) => {
	assert.equal(address, v.proof.account.address);
	assert.equal(bytesToHex(bytes), v.canonicalHex);
	return {
		signature: v.proof.signature,
		...(v.proof.publicKey ? { publicKey: v.proof.publicKey } : {}),
	};
};
async function approveFixture(v, provider) {
	let submitted = 0;
	const client = new ConnectClient(
		provider,
		{
			challenge: async () => v.challenge,
			approve: async (_, proof) => {
				await new ProfileRegistry()
					.get(proof.profile)
					.verify(v.challenge, proof);
				submitted++;
				return { requestId: proof.requestId, status: 'APPROVED' };
			},
		},
		undefined,
		() => Date.parse(v.challenge.issuedAt),
	);
	const request = await client.resolve(
		'connect://example.com/connect/v1/' + v.challenge.requestId,
	);
	assert.equal(submitted, 0);
	await request.approve(request.accounts[0]);
	assert.equal(submitted, 1);
}
for (const chain of allChains) {
	test(`${chain.name}: wallet-neutral bridge submits its exact supported proof`, async () => {
		const v = vectors.find(
			(v) =>
				v.proof.profile === chain.profile &&
				v.proof.account.reference === chain.reference,
		);
		const driver = {
			getAccounts: async () => [v.proof.account.address],
			sign: fixtureSign(v),
		};
		const provider =
			chain.namespace === 'bip122'
				? bitcoinAccountProvider(driver, chain)
				: chain.profile === 'stellar-sep53'
					? stellarAccountProvider(driver)
					: chain.profile === 'monero-spend-v2'
						? moneroAccountProvider(driver)
						: chain.namespace === 'xrpl'
							? rippleAccountProvider(
									driver,
									chain.alg === -19 ? 'ed25519' : 'secp256k1',
								)
							: walletAccountProvider({ ...driver, chain });
		await approveFixture(v, provider);
	});
}
test('Core mainnet and Devin: real Ed448 bridge signs and verifies; key stays with wallet', async () => {
	for (const network of ['mainnet', 'devin']) {
		const chain = coreChain(network),
			seed = new Uint8Array(57).fill(1),
			key = ed448.getPublicKey(seed),
			address = coreAddress(key, chain.reference);
		let signatures = 0;
		const provider = coreAccountProvider(
			{
				getAccounts: async () => [
					{ address, publicKey: key, reference: chain.reference },
				],
				async signConnect(input) {
					signatures++;
					assert.equal(input.algorithm, 'Ed448');
					return ed448.sign(input.message, seed);
				},
			},
			chain,
		);
		const request = new BrowserConnect({
			origin: 'https://example.com',
			chains: [chain],
		}).create();
		const accounts = await provider.getAccounts();
		assert.equal(signatures, 0);
		const proof = await signBrowserChallenge(request.challenge, accounts[0]);
		assert.equal((await request.verify(proof)).address, address);
		assert.equal(validateCoreAddress(address, chain.reference), true);
		assert.equal(
			validateCoreAddress(address, chain.reference === '1' ? '3' : '1'),
			false,
		);
	}
	const referenceSeed = Uint8Array.from(
		Buffer.from(
			'69bb68c3a00a0cd9cbf2cab316476228c758329bbfe0b1759e8634694a9497afea05bcbf24e2aa0627eac4240484bb71de646a9296872a3c0e',
			'hex',
		),
	);
	assert.equal(
		coreAddress(ed448.getPublicKey(referenceSeed)),
		'cb82a5fd22b9bee8b8ab877c86e0a2c21765e1d5bfc5',
	);
});
test('Core rejects a mismatched key, foreign signature and added signing prefix', async () => {
	const seed = new Uint8Array(57).fill(1),
		key = ed448.getPublicKey(seed),
		address = coreAddress(key),
		account = { address, publicKey: key, reference: '1' };
	await assert.rejects(
		coreAccountProvider({
			getAccounts: async () => [
				{
					...account,
					publicKey: ed448.getPublicKey(new Uint8Array(57).fill(2)),
				},
			],
			signConnect: async () => new Uint8Array(114),
		}).getAccounts(),
	);
	for (const signConnect of [
		async ({ message }) => ed448.sign(message, new Uint8Array(57).fill(2)),
		async ({ message }) => ed448.sign(new Uint8Array([0, ...message]), seed),
	]) {
		const [wallet] = await coreAccountProvider({
			getAccounts: async () => [account],
			signConnect,
		}).getAccounts();
		await assert.rejects(wallet.sign(new Uint8Array([1, 2, 3])));
	}
	assert.equal(
		verifyCoreSignature(new Uint8Array(), new Uint8Array(64), key),
		false,
	);
});
test('Phantom-compatible Solana byte signature and account changes', async () => {
	const v = find('solana-ed25519'),
		publicKey = { toBase58: () => v.proof.account.address };
	const provider = {
		publicKey,
		async signMessage(message, display) {
			assert.equal(display, 'utf8');
			assert.equal(bytesToHex(message), v.canonicalHex);
			return {
				signature: Uint8Array.from(Buffer.from(v.proof.signature, 'hex')),
				publicKey,
			};
		},
	};
	await approveFixture(v, solanaAccountProvider(provider));
	const [account] = await solanaAccountProvider(provider).getAccounts();
	provider.publicKey = null;
	await assert.rejects(account.sign(new Uint8Array()));
});
test('Wallet Standard discovers brands by capability and rejects rewritten messages', async () => {
	const v = find('solana-ed25519'),
		account = {
			address: v.proof.account.address,
			publicKey: base58.decode(v.proof.account.address),
			chains: ['solana:mainnet'],
			features: ['solana:signMessage'],
		};
	let connects = 0,
		modified = false;
	const wallet = {
		version: '1.0.0',
		name: 'Any Solana Wallet',
		icon: 'data:image/png;base64,',
		chains: ['solana:mainnet'],
		accounts: [account],
		features: {
			'standard:connect': {
				version: '1.0.0',
				async connect() {
					connects++;
					return { accounts: [account] };
				},
			},
			'solana:signMessage': {
				version: '1.0.0',
				async signMessage({ message }) {
					return [
						{
							signedMessage: modified
								? new Uint8Array([0, ...message])
								: message,
							signature: Uint8Array.from(Buffer.from(v.proof.signature, 'hex')),
						},
					];
				},
			},
		},
	};
	const unregister = getStandardWallets().register(wallet);
	try {
		assert.ok(getSolanaWallets().includes(wallet));
		assert.equal(connects, 0);
		await requestStandardAccounts(wallet);
		assert.equal(connects, 1);
		await approveFixture(v, solanaStandardAccountProvider(wallet));
		modified = true;
		const [w] = await solanaStandardAccountProvider(wallet).getAccounts();
		await assert.rejects(w.sign(new Uint8Array([1])));
	} finally {
		unregister();
	}
	assert.equal(getSolanaWallets().includes(wallet), false);
});
test('CIP-30: hex addresses and COSE results map to Cardano proofs', async () => {
	const v = find('cardano-cip8'),
		raw = bytesToHex(
			bech32.fromWords(bech32.decode(v.proof.account.address, 128).words),
		);
	let network = 1;
	const provider = {
		getNetworkId: async () => network,
		getUsedAddresses: async () => [raw],
		getUnusedAddresses: async () => [],
		async signData(address, message) {
			assert.equal(address, raw);
			assert.equal(message, v.canonicalHex);
			return { signature: v.proof.signature, key: v.proof.publicKey };
		},
	};
	await approveFixture(v, cardanoAccountProvider(provider));
	network = 0;
	await assert.rejects(cardanoAccountProvider(provider).getAccounts());
});
test('TronLink-style signMessageV2 and network binding', async () => {
	const v = find('tron-signmessage-v2');
	let network = '0x2b6653dc';
	const provider = {
		request: async () => network,
		tronWeb: {
			defaultAddress: { base58: v.proof.account.address },
			trx: {
				async signMessageV2(bytes) {
					assert.equal(bytesToHex(bytes), v.canonicalHex);
					return v.proof.signature;
				},
			},
		},
	};
	await approveFixture(v, tronLinkAccountProvider(provider));
	network = '0x1';
	await assert.rejects(tronLinkAccountProvider(provider).getAccounts());
});
test('EIP-6963 discovery is brand-neutral, passive, deduplicated and disposable', () => {
	const target = new EventTarget(),
		provider = {
			request() {
				throw Error('discovery must not request accounts');
			},
		};
	const announce = (uuid = '12345678-1234-1234-1234-123456789012') =>
		target.dispatchEvent(
			new CustomEvent('eip6963:announceProvider', {
				detail: {
					info: {
						uuid,
						name: 'Any Wallet',
						icon: 'data:image/png;base64,',
						rdns: 'example.wallet',
					},
					provider,
				},
			}),
		);
	target.addEventListener('eip6963:requestProvider', () => announce());
	const discovery = discoverEthereumWallets(target);
	assert.equal(discovery.get().length, 1);
	announce();
	assert.equal(discovery.get().length, 1);
	discovery.dispose();
	announce();
	assert.equal(discovery.get().length, 0);
	assert.throws(() => discovery.refresh());
});
test('composed wallets preserve choices and renamed entry replaces evm', async () => {
	const v = find('solana-ed25519'),
		provider = walletAccountProvider({
			chain: chains.solana,
			getAccounts: async () => [v.proof.account.address],
			sign: fixtureSign(v),
		});
	assert.equal(
		(await combineWalletProviders(provider, provider).getAccounts()).length,
		2,
	);
	const manifest = JSON.parse(
		readFileSync(new URL('../package.json', import.meta.url)),
	);
	assert.ok(manifest.exports['./wallet']);
	assert.equal(manifest.exports['./evm'], undefined);
	assert.equal(existsSync(new URL('../dist/evm.js', import.meta.url)), false);
});

test('Core address validation and proof hex reject trailing whitespace', async () => {
	const key = ed448.getPublicKey(new Uint8Array(57).fill(1));
	assert.equal(validateCoreAddress(coreAddress(key) + '\n'), false);
	const provider = walletAccountProvider({
		chain: chains.solana,
		getAccounts: async () => [find('solana-ed25519').proof.account.address],
		sign: async () => ({ signature: '00\n' }),
	});
	const [account] = await provider.getAccounts();
	await assert.rejects(account.sign(new Uint8Array()));
});
