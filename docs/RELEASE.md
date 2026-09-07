# Release setup

CI runs formatting/linting, static checks, relevant tests and package validation. Flutter additionally builds Android and iOS simulator examples. better-connect's release also runs cross-repository Flutter interoperability. No release has been pushed or published as part of implementation.

1. Review the package version and changelog. Keep v1 protocol vectors identical across all three repositories.
2. Configure repository Actions and the registry's trusted publisher for `bchainhub/connect.js` and `release.yml`. For npm use its GitHub OIDC trusted publishing settings; for pub.dev enable automated GitHub publishing with the `{{version}}` tag pattern. Initial package creation/ownership and registry settings must be established by maintainers.
3. Ensure dependent repositories are pushed before cross-repository CI runs. For incompatible future protocol changes pin the integration checkout to a matching release rather than silently mixing versions.
4. Push `<version>` to trigger validation, publication and a GitHub release. The tag must match the manifest exactly.

CORE License text is copied unchanged from the reference flutter_txms repository. npm metadata uses `SEE LICENSE IN LICENSE` because CORE is a custom license.

For better-connect, CI checks out the matching SDK source and runs `node scripts/prepare-sdk.mjs` before installing dependencies. The helper builds the ignored vendor tarball; `node scripts/sync-protocol.mjs` refreshes a local installation. Reference conformance fixtures live in `test/fixtures/` and remain versioned. Generated `vectors/` and `vendor/` directories are ignored. The published bundle includes the SDK so registry users do not need local filesystem dependencies.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [Dart publishing workflow](https://github.com/dart-lang/setup-dart/blob/main/.github/workflows/publish.yml).

Dependency lockfiles are ignored. npm workflows install from package.json with `--package-lock=false`; npm cache keys use package.json. Flutter workflows already resolve dependencies with `flutter pub get`.

The main entry point is the browser API. Builds clear generated output before compiling, and the package allowlist includes only browser JavaScript, declarations, docs and fixtures. Package tests reject server files, legacy entry points and bundled node_modules, then run all seventeen fixtures in Chromium from the installed tarball. CI installs Chromium before running browser and package checks. Build-time crypto dependencies are bundled with their license notices; only public declaration dependencies are installed by consumers.
