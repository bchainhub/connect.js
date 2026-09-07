# Nearby wallet dapp

Run `npm install --package-lock=false` and `npm run build`, then serve the repository from an HTTPS DNS origin and open `/examples/nearby/index.html`. Local development needs a trusted certificate and DNS name such as `connect.test`, without a custom port; Connect does not accept localhost/IP origins.

1. Click **New request** and scan the QR with your wallet's scanner, or open its full `connect://` link. The Flutter example also accepts pasted links.
2. In the wallet, review the requested website and account. Enable nearby Bluetooth if using BLE, and keep the app open.
3. Click **Receive via Bluetooth** in the portal. It requests device selection and connects automatically. Alternatively, use **Connect device** first, then **Receive via Bluetooth**; a disconnected selected device reconnects automatically.
4. Approve the signature in the wallet. The browser collects the encrypted packet, verifies wallet ownership, and shows the verified identity.

Alternatively, copy the encrypted response from the wallet into the portal and click **Verify response**. A host QR scanner can populate the same input from the wallet's response QR. The example does not include a camera scanner. Start a new request for another sign-in.

The Flutter example uses an ephemeral raw Ed25519 account; this portal explicitly allows that test profile alongside Core and Ethereum. Production dapps should request their intended chains. Every verification remains local: no server, database or RPC call. Load assets before disconnecting from the internet; provisioning an offline app cache is the host's responsibility.

See [transport details and platform limits](../../docs/NEARBY.md). Keep all `dist/browser` chunks and license notices with the static deployment. Browser tests simulate BLE and use real signatures; physical BLE devices must still be tested.
