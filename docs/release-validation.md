# Release validation — 0.2.0

Validated on 2026-10-31 with Node 26.12.1, Flutter 3.47.2 and Dart 3.13.2.
All three workspace packages now declare version 0.2.0. No commits, tags, pushes or
registry publications were made during preparation.

| Package | Validation |
| --- | --- |
| connect-protocol (connect.js) | 230 tests passed on Node 22, 24 and 26; type checking, lint/format, browser package installation, TypeScript consumer and encrypted operation interoperability passed. |
| flutter_connect | 203 tests passed; 17 optional server integration cases are skipped in the default suite and exercised by the live backend run. Eight Chrome tests and two example tests passed. Formatting and static analysis passed. |
| better-connect | 130 tests passed, with one optional Dart response-file test skipped in the default suite. Its separate live interoperability run executes that test with real Dart output. Type checking, lint, a clean standalone tarball install and all 17 installed-package proof fixtures passed. |

## Builds and package score

- Flutter example Android debug APK and iOS simulator application built successfully.
- Flutter publish dry-run from a clean source snapshot: zero warnings.
- Flutter pana: **150/160**, including full analysis and dependency scores and 28.0%
  public API documentation coverage. The remaining 10 points require an OSI-approved
  license; the existing CORE license is preserved.
- The complete Flutter package is not tagged as Web-compatible by pana because its
  Bluetooth dependency supports native platforms only. The browser provider APIs are
  covered separately by the eight Chrome tests.

## Independence and interoperability

better-connect owns its authentication schemas, canonical messages, Core signature
helpers, verification profiles and encrypted handoff codec. It has no connect-protocol
runtime, development or peer dependency; no Git source pin; no SDK archive; and no
sibling SDK checkout in its build, package checks or release workflow. Its package
check explicitly verifies that connect-protocol cannot be resolved in the consumer.

The live backend run authenticated and redeemed 17 real Better Auth sessions from
Flutter across all proof variants. Flutter encrypted response packets also decrypt
through better-connect's own codec. Shared conformance and wallet-validation fixtures
remain byte-identical across the three repositories. Cross-repository Flutter checks
are a separate workflow, not a prerequisite for the backend package release.

## Dependency and audit notes

Direct dependencies are current. Node type declarations remain on the latest Node 22
line to match the supported runtime baseline. Flutter's remaining older transitive
packages are constrained by upstream dependencies or the Flutter SDK; no forced
overrides were introduced for them.

Both npm tarballs pass their clean-consumer production audits with zero advisories.
The connect.js full development audit also has zero advisories. better-connect retains
three low-severity development-only notices in bitcoinjs-message's elliptic/secp256k1
test signer; production verification uses noble and the clean consumer has no such
notices.

BIP-322 4.0.0 is incompatible with newer bitcoinjs-lib transaction extraction. Both
packages use a targeted bitcoinjs-lib 7.0.1 override, verified against the proof
fixtures. better-connect bundles BIP-322 so consumer installation preserves this
compatibility. Its TRON runtime is bundled with a patched Axios dependency. Obsolete
Monero serialize-javascript/uuid overrides were removed because the current Monero
release no longer depends on them.
