import {
	BrowserConnect,
	createBrowserHandoff,
	receiveBluetoothResponse,
	connectBluetoothDevice,
	disconnectBluetoothDevice,
	chains,
	requirementsFor,
} from 'connect.js';
import { toCanvas } from 'qrcode';
const el = (id) => document.getElementById(id);
let exchange, controller, request, device;
const portal = new BrowserConnect({
	origin: location.origin,
	requirements: [
		...requirementsFor([chains.ethereum, chains.core]),
		{
			namespace: 'raw',
			reference: 'ed25519',
			profile: 'raw-ed25519',
			alg: -19,
		},
	],
});
const show = (value) => {
	el('status').textContent = value;
};
async function accept(packet, current) {
	const identity = await current.accept(packet);
	if (current !== exchange) return;
	controller.abort();
	el('connect').disabled =
		el('bluetooth').disabled =
		el('accept').disabled =
			true;
	if (device) disconnectBluetoothDevice(device);
	device = undefined;
	show('Wallet verified: ' + JSON.stringify(identity, null, 2));
}
el('create').onclick = async () => {
	controller?.abort();
	if (device) disconnectBluetoothDevice(device);
	device = undefined;
	controller = new AbortController();
	if (request?.status === 'PENDING') request.cancel();
	request = portal.create();
	exchange = createBrowserHandoff(request);
	el('link').href = exchange.uri;
	el('connect').disabled =
		el('bluetooth').disabled =
		el('accept').disabled =
			false;
	el('response').value = '';
	show(
		'Confirm website: ' +
			location.origin +
			'\nExpires: ' +
			exchange.ticket.challenge.expiresAt,
	);
	try {
		await toCanvas(el('qr'), exchange.uri, {
			width: 460,
			errorCorrectionLevel: 'L',
		});
	} catch (error) {
		show(error.message);
	}
};
el('connect').onclick = async () => {
	const current = exchange;
	el('connect').disabled = el('bluetooth').disabled = true;
	try {
		const selected = await connectBluetoothDevice(current.ticket, {
			device,
			signal: controller.signal,
		});
		if (current !== exchange || request.status !== 'PENDING') {
			disconnectBluetoothDevice(selected);
			return;
		}
		device = selected;
		show(
			'Device connected. Approve in your wallet, then receive the response.',
		);
	} catch (error) {
		if (current === exchange) show(error.message);
	} finally {
		if (current === exchange && request.status === 'PENDING')
			el('connect').disabled = el('bluetooth').disabled = false;
	}
};
el('bluetooth').onclick = async () => {
	const current = exchange;
	el('connect').disabled = el('bluetooth').disabled = true;
	try {
		await accept(
			await receiveBluetoothResponse(current.ticket, {
				signal: controller.signal,
				device,
			}),
			current,
		);
	} catch (error) {
		if (current === exchange) show(error.message);
	} finally {
		if (current === exchange && request.status === 'PENDING')
			el('connect').disabled = el('bluetooth').disabled = false;
	}
};
el('accept').onclick = async () => {
	const current = exchange;
	try {
		await accept(el('response').value.trim(), current);
	} catch (error) {
		if (current === exchange) show(error.message);
	}
};
