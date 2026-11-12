# Release Integrity — P3 build-time candidate (#196)

**Status: isolated, UNSIGNED candidate only.** This directory is an independent Node.js 22+ CLI + test module. It does **not** register a CI workflow, modify the PWA, ship a public verifier, sign a release, prevent browser bootstrap compromise, or activate an update. See `ts.md` §24–24.1 and Issue #196.

## Usage

From the repository root, after building the web application:

```sh
node scripts/release-integrity/cli.mjs build \
  --root apps/web/dist \
  --out /tmp/pb3-release-manifest.json \
  --release-id pb3-2026-11-12-001 \
  --release-sequence 1001 \
  --build-time 2026-11-12T09:00:00.000Z \
  --min-client-version 1.0.0 \
  --require-sw

node scripts/release-integrity/cli.mjs verify \
  --root apps/web/dist \
  --manifest /tmp/pb3-release-manifest.json \
  --expected-sha256 "$(sha256sum /tmp/pb3-release-manifest.json | cut -d' ' -f1)" \
  --minimum-sequence 1001 \
  --require-sw

node --test scripts/release-integrity/integrity.test.mjs
```

The SHA-256 command above is **local self-check only**, not independent authenticity. A signing/verification pipeline must obtain the expected digest and latest trusted release sequence from a separately authenticated source. Never compare an arbitrary manifest with a digest delivered beside it and claim that this authenticates a release.

For release metadata, provide a fixed UTC millisecond `--build-time` (for example derived from a reproducible build's `SOURCE_DATE_EPOCH`), a monotonically increasing `--release-sequence`, a stable `--release-id` and a `X.Y.Z` minimum client version. If needed, pass `--feature-flags /path/to/flags.json` containing a flat JSON object of boolean keys. A nonstandard Service Worker name is supported via `--service-worker relative/path/to/worker.js`. For PWA builds, use `--require-sw`; absent or ambiguous workers cause failure.

Manifest JSON is canonical (sorted object keys, sorted asset paths, compact UTF-8, LF terminator) and covers every regular file in the build directory: HTML, JavaScript, CSS, WebAssembly, images, scripts imported by Service Worker and other assets. The worker is also recorded explicitly. Its canonical UTF-8 bytes are the input to the future detached Ed25519 signer.

The builder rejects symlinks, hard links, non-regular files, ambiguous paths and writing a manifest inside the build directory. The verifier rejects unknown fields, malformed or noncanonical manifest JSON, missing/extra/modified files, worker mismatch and release sequences below an externally supplied minimum. The output is `UNSIGNED_CANDIDATE` or `INTEGRITY_OK_UNSIGNED`; neither means a trusted signature was checked. An altered manifest plus matching altered files cannot be authenticated without an independent trust anchor.

## Tests and pending integration

`node --test scripts/release-integrity/integrity.test.mjs` runs deterministic fixtures and CLI tests (32 cases). Negative cases include tampered JS/CSS/HTML/SW/WASM/assets, a changed manifest digest, rollback, missing and extra files, unsafe traversal, file/directory symlinks and dual Service Workers. These are build-time integrity tests, **not** a security review of the browser bootstrap.

**NOT IMPLEMENTED:** detached Ed25519 signing, key rotation/revocation, independent trust anchor, signed baseline persistence, CDN/cache mismatch handling, verified PWA activation/rollback, device acceptance and wiring into CI. Those gates must be implemented and reviewed before any public "verified release" claim. No private signing key is created or retained here.
