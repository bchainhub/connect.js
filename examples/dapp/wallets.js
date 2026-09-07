/** Host integrations use this registry without changing the dapp's login flow. */
const wallets = new Map();
const listeners = new Set();
export function registerWallet(wallet) {
	if (
		!wallet.id ||
		!wallet.name ||
		!wallet.chains?.length ||
		typeof wallet.authorize !== 'function'
	)
		throw new Error('Invalid wallet integration');
	if (wallets.has(wallet.id)) return () => {};
	wallets.set(wallet.id, wallet);
	for (const listener of listeners) listener();
	return () => {
		wallets.delete(wallet.id);
		for (const listener of listeners) listener();
	};
}
export function getWallets() {
	return [...wallets.values()];
}
export function onWalletsChanged(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
