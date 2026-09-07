# Nearby and offline Connect

Connect supports any dapp. Better Auth is an optional portal integration.

1. The portal creates a challenge and pairing ticket, then displays the full `connect://` URI as a QR code or link.
2. The wallet validates the embedded challenge, displays the website, chain, account and expiry, and asks the user to approve. No HTTP lookup is needed.
3. The wallet signs with its account signer and encrypts the proof for this ticket.
4. The portal receives the packet over Bluetooth or another channel, decrypts it, and verifies the signature and its binding to the claimed wallet address against its original challenge.
5. A browser-only dapp uses the verified identity locally. A Better Auth portal submits the proof to its server, which verifies it and creates a session after separate redemption.

## Bluetooth and other channels

The native wallet advertises as a BLE peripheral; the browser connects as the central. After scanning, confirm the website and enable Bluetooth in the wallet, keep it in the foreground, and click the portal's device chooser. Approval releases the encrypted response. Stop on cancellation, expiry or disposal. Run one peripheral handoff at a time.

Web Bluetooth requires a secure context, a user gesture and permission, and has limited browser availability. Feature-detect `navigator.bluetooth`; a browser tab cannot advertise. See [MDN Web Bluetooth](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API). Flutter uses [bluetooth_low_energy](https://github.com/yanshouwang/bluetooth_low_energy); native peripheral support covers Android, iOS, macOS and Windows, subject to hardware and permissions. Linux and Flutter Web use another response channel. Physical-device validation is required before deployment.

No internet or database is needed for browser verification or the wallet exchange once application assets are available. Loading an uncached site needs connectivity. A Better Auth session requires a reachable server, possibly on a local network. Bluetooth cannot create that server session while the server is unreachable.

The packet is a string: clipboard/manual transfer, a response QR scanner, a host bridge or a local-network channel can deliver it to the same `accept` method. Hosts supply scanners or bridges; WebRTC/NFC/Wi-Fi Direct adapters are not included. Large multi-chain challenges may exceed one QR's capacity: request relevant chains or use the full link/text.

## Pairing and trust

The full URI is `connect://<domain>/connect/v1/<requestId>#<payload>`. Payload is unpadded base64url of UTF-8 JSON with exactly `type: "connect:handoff:1"`, `challenge` and `key`. The key is 32 fresh random bytes encoded as 64 lowercase hex characters. Never log or persist the QR/link. Better Auth's redemption secret is separate and never enters the payload.

The response has exactly `type: "connect:response:1"`, `requestId`, `iv` and `ciphertext`. AES-256-GCM uses a fresh 12-byte nonce; IV and ciphertext plus the 16-byte tag are unpadded base64url. Additional authenticated data is UTF-8 `<origin>/<requestId>`. Limits are 32,768 characters for a URI or packet and 16,384 bytes for plaintext proof. Verification enforces expiry and single-use acceptance.

Encryption protects the return channel; signature verification still proves the wallet address. An offline QR does not prove ownership of its claimed website: display and explicitly confirm the origin, or pin it through a trusted channel. A copied QR carries its pairing key. Do not infer physical proximity or phishing resistance from BLE alone.

The service UUID uses the first 32 hex characters of requestId in UUID formatting. Control characteristic `b6c01402-df5b-4b79-9f8d-8a642b9cd001` accepts a four-byte little-endian offset. Response characteristic `b6c01403-df5b-4b79-9f8d-8a642b9cd001` returns little-endian total length and offset (four bytes each), then at most 12 bytes. A zero-length header at offset zero means approval is pending. Frames fit a 20-byte ATT payload. Lengths and offsets are bounded and checked.

## Connect a device explicitly or on transfer

All device helpers are exported from `connect.js`:

```ts
import {
 connectBluetoothDevice, disconnectBluetoothDevice,
 isBluetoothDeviceConnected, receiveBluetoothResponse,
} from 'connect.js';

// In the Connect device button handler:
const device = await connectBluetoothDevice(handoff.ticket);
console.log(isBluetoothDeviceConnected(device));

// In the Receive button handler. Reconnects this device if disconnected:
const packet = await receiveBluetoothResponse(handoff.ticket, { device });
const identity = await handoff.accept(packet);

// To cancel an idle explicit connection:
disconnectBluetoothDevice(device);
```

Explicit connection verifies that the device exposes this request's service. Without a `device`, `receiveBluetoothResponse(ticket)` opens the device chooser and connects before transfer. With an authorized device it reuses its connection or reconnects without another chooser. No device selection is stored by the SDK. A new handoff advertises a different service; choose the device for that handoff again to grant service access.

Pass an `AbortSignal` to either asynchronous helper to cancel the operation. Explicit connections stay open until disconnected by the caller or peripheral; transfers disconnect on success, cancellation or failure. If the link drops during a transfer, retry with the same authorized device while the challenge remains valid; transfer restarts from offset zero. Permission denial and connection failure are reported to the caller without repeated permission prompts. A new chooser requires a user gesture, so background code must offer a Connect button instead of trying to bypass browser permission rules.
