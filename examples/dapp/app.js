import {
	BrowserConnect,
	signBrowserChallenge,
	canonicalMessage,
	chains,
	discoverEthereumWallets,
	ethereumAccountProvider,
	requestEthereumAccounts,
	getStandardWallets,
	getSolanaWallets,
	requestStandardAccounts,
	solanaStandardAccountProvider,
} from 'connect.js';
import { registerWallet, getWallets, onWalletsChanged } from './wallets.js';

const element = (id) => document.getElementById(id);
let accounts = [],
	request,
	verified,
	busy = false,
	generation = 0;
let unsubscribeWallet = () => {};
const say = (message) => {
	element('status').textContent = message;
};
function reset(message = 'Choose your wallet and network.') {
	generation++;
	if (request?.status === 'PENDING') request.cancel();
	request = undefined;
	verified = undefined;
	accounts = [];
	busy = false;
	unsubscribeWallet();
	unsubscribeWallet = () => {};
	element('account').replaceChildren();
	element('review').hidden = true;
	element('dashboard').hidden = true;
	element('message').textContent = '';
	say(message);
	renderControls();
}
function selectedWallet() {
	return getWallets().find((wallet) => wallet.id === element('wallet').value);
}
function selectedChain() {
	return selectedWallet()?.chains[Number(element('network').value)];
}
function renderControls() {
	element('wallet').disabled = busy;
	element('network').disabled = busy;
	element('account').disabled = busy || Boolean(verified);
	element('connect').disabled = busy || !selectedWallet();
	element('sign').disabled =
		busy || !accounts.length || request?.status !== 'PENDING';
	element('cancel').disabled = !busy && !request && !verified;
}
function showMessage() {
	const account = accounts[Number(element('account').value)];
	if (request && account)
		element('message').textContent = canonicalMessage(
			request.challenge,
			account,
		);
}
function renderNetworks() {
	element('network').replaceChildren();
	for (const [index, chain] of (selectedWallet()?.chains ?? []).entries())
		element('network').add(new Option(chain.name, String(index)));
}
function renderWallets() {
	const previous = element('wallet').value;
	element('wallet').replaceChildren();
	for (const wallet of getWallets())
		element('wallet').add(new Option(wallet.name, wallet.id));
	if (getWallets().some((wallet) => wallet.id === previous))
		element('wallet').value = previous;
	else {
		reset();
		renderNetworks();
	}
	if (!getWallets().length)
		say(
			'No compatible wallet found. Open your wallet extension, then refresh wallets.',
		);
	renderControls();
}
function errorMessage(error) {
	if (error?.code === 4001 || error?.code === '4001')
		return 'You declined the wallet request. Try again when ready.';
	const messages = {
		networkMismatch:
			'Switch your wallet to the selected network, then connect again.',
		accountChanged: 'Your wallet account changed. Connect again.',
		expiredRequest:
			'The request expired. Connect again to create a new request.',
		invalidProof: 'The wallet signature could not be verified. Connect again.',
	};
	return (
		messages[error?.code] ??
		'Could not complete wallet sign-in. Check your wallet and try again.'
	);
}
// Permission and signing are separate user actions. Discovery never prompts.
element('connect').onclick = async () => {
	reset();
	const wallet = selectedWallet(),
		chain = selectedChain(),
		attempt = generation;
	if (!wallet || !chain) return;
	busy = true;
	renderControls();
	say('Approve account access in your wallet.');
	try {
		const provider = await wallet.authorize(chain);
		const available = await provider.getAccounts();
		if (attempt !== generation) return;
		accounts = available.filter(
			(account) =>
				account.profile === chain.profile &&
				account.alg === chain.alg &&
				account.account.namespace === chain.namespace &&
				account.account.reference === chain.reference,
		);
		if (!accounts.length) throw new Error('No compatible accounts');
		request = new BrowserConnect({ chains: [chain] }).create();
		for (const [index, account] of accounts.entries())
			element('account').add(
				new Option(account.account.address, String(index)),
			);
		unsubscribeWallet =
			wallet.onChange?.(() =>
				reset(
					'Your wallet changed. Connect again to verify the current account.',
				),
			) ?? (() => {});
		element('review').hidden = false;
		element('origin').textContent = request.challenge.origin;
		element('expires').textContent = new Date(
			request.challenge.expiresAt,
		).toLocaleTimeString();
		showMessage();
		say('Review the sign-in message, choose an account, then sign.');
	} catch (error) {
		if (attempt === generation) reset(errorMessage(error));
	} finally {
		if (attempt === generation) {
			busy = false;
			renderControls();
		}
	}
};
element('sign').onclick = async () => {
	const attempt = generation,
		pending = request,
		account = accounts[Number(element('account').value)];
	if (!pending || !account || pending.status !== 'PENDING') return;
	busy = true;
	renderControls();
	say('Approve the sign-in message in your wallet.');
	try {
		const proof = await signBrowserChallenge(pending.challenge, account);
		if (attempt !== generation) return;
		const identity = await pending.verify(proof);
		if (attempt !== generation) return;
		verified = identity;
		element('identity').textContent =
			`${verified.namespace}:${verified.reference}:${verified.address}`;
		element('dashboard').hidden = false;
		say('Wallet verified locally. You are signed in to this page.');
	} catch (error) {
		if (attempt === generation) reset(errorMessage(error));
	} finally {
		if (attempt === generation) {
			busy = false;
			renderControls();
		}
	}
};
element('wallet').onchange = () => {
	reset();
	renderNetworks();
};
element('network').onchange = () => reset();
element('account').onchange = showMessage;
element('cancel').onclick = () =>
	reset('Signed out. Your local sign-in state has been cleared.');
element('logout').onclick = () =>
	reset('Signed out. Your local sign-in state has been cleared.');

onWalletsChanged(renderWallets);
const discovery = discoverEthereumWallets(window, () =>
	queueMicrotask(discover),
);
function discover() {
	for (const { info, provider } of discovery.get())
		registerWallet({
			id: 'ethereum:' + info.uuid,
			name: info.name,
			chains: [chains.ethereum, chains.polygon, chains.base, chains.bnb],
			async authorize(chain) {
				await requestEthereumAccounts(provider);
				return ethereumAccountProvider(provider, chain);
			},
			onChange(callback) {
				provider.on?.('accountsChanged', callback);
				provider.on?.('chainChanged', callback);
				provider.on?.('disconnect', callback);
				return () => {
					provider.removeListener?.('accountsChanged', callback);
					provider.removeListener?.('chainChanged', callback);
					provider.removeListener?.('disconnect', callback);
				};
			},
		});
	for (const wallet of getSolanaWallets()) {
		if (!standardIds.has(wallet))
			standardIds.set(wallet, 'solana:' + crypto.randomUUID());
		if (!standardRemovers.has(wallet))
			standardRemovers.set(
				wallet,
				registerWallet({
					id: standardIds.get(wallet),
					name: wallet.name,
					chains: [chains.solana],
					async authorize() {
						await requestStandardAccounts(wallet);
						return solanaStandardAccountProvider(wallet);
					},
					onChange(callback) {
						return (
							wallet.features['standard:events']?.on('change', callback) ??
							(() => {})
						);
					},
				}),
			);
	}
	renderWallets();
}
const standardIds = new WeakMap();
const standard = getStandardWallets();
const stopRegister = standard.on('register', discover);
const stopUnregister = standard.on('unregister', (...wallets) => {
	for (const wallet of wallets) {
		standardRemovers.get(wallet)?.();
		standardRemovers.delete(wallet);
	}
	discover();
});
// Unregister entries when a Wallet Standard provider disappears.
const standardRemovers = new WeakMap();
// Register event cleanup and pending-request cancellation for page teardown.
const timer = setInterval(() => {
	if (request?.status === 'EXPIRED' && !verified)
		reset('The request expired. Connect again to create a new request.');
}, 1000);
element('refresh').onclick = () => {
	discovery.refresh();
	discover();
};
window.addEventListener('pagehide', (event) => {
	reset();
	if (event.persisted) return;
	clearInterval(timer);
	discovery.dispose();
	stopRegister();
	stopUnregister();
});
discover();
