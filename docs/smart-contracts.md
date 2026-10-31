# Contract ABI, calls and deployment

Both libraries implement ABI encoding/decoding for Ethereum and Core: integer widths,
booleans, addresses, fixed/dynamic bytes, UTF-8 strings, arrays (including fixed and
nested arrays), and tuples. Overloaded functions require an unambiguous full signature.
Malformed bounds, unsupported ABI types and invalid arguments fail explicitly. Standalone encodeWalletContract/decodeWalletContract helpers are exported for use without a provider connection.

Ethereum uses Keccak selectors and 20-byte addresses. Core uses SHA3-256 selectors
and 22-byte Ylem addresses, including CIP-100 zero/precompile system values. A real
zero address is distinct from a checksummed ICAN with zero BCAN. System values cannot
be used as signing accounts. Independent viem and CoreBC vectors cover both codecs;
Flutter uses the already-present PointyCastle dependency directly for hashes and
Ethereum message verification. No runtime dependency on the sibling CoreBC checkout
is needed.

encodeContractCall({abi,functionName,args}) and decodeContractResult({abi,functionName,
data}) are local operations. callContract accepts native {to,data,...} or
{address,abi,functionName,args,...}; readContract additionally decodes ABI results.
Callers retain native bigint/BigInt values; Flutter's JS bridge preserves JS bigint
inputs and outputs. nativeOptions forwards explicit compatible SDK options where
supported. Raw wallet RPC calls are still subject to their adapter allowlist.

When declared native methods permit it, sendContractTransaction/writeContract encode
then submit through the selected wallet, estimateContractGas estimates gas/energy,
and getContractEvents uses native logs. deployContract accepts {bytecode,abi?,args?,
...transaction} and encodes constructor arguments without inventing deployment data.
It does not return an invented contract instance or infer a deployment address.

Token helpers map ABI-compatible balanceOf, allowance, approve, transfer, name, symbol
and decimals methods. transferNFT supports ERC-721 compatible safeTransferFrom and
explicit standard: 'erc1155' requests with tokenId/amount/data. Amounts/token IDs are
raw integer values; human decimal conversions and unlimited approvals are never
inserted. A token's nonstandard ABI can still reject these operations.

No EVM ABI is applied to Solana programs, Cardano scripts, Move transactions, TON
cells, NEAR actions, Monero or Zcash. Those use actual native SDK handlers.
