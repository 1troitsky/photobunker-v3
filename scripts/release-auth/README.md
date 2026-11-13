# P3 signed release verification contract — #230

**Scope:** Node 22+ offline/build-side verifier only. This does not implement PWA bootstrap, a signing service, trust anchor deployment, a Service Worker update, or first-install security. The dependency #196 is in [Draft PR #250](https://github.com/1troitsky/photobunker-v3/pull/250) and has not been merged into main.

## Detached signing format

Use exact canonical UTF-8 + LF manifest bytes produced by #196, then have an **independently protected signing service** sign those bytes with Ed25519. Private signing keys must never be included in this repository, CI checkout, browser JavaScript, same-origin deployment or frontend config.

The detached signature file is canonical JSON with a trailing LF and precisely four keys:

- `signature_version`: integer 1
- `key_id`: lowercase SHA-256 hex digest of DER SPKI trusted public key
- `manifest_sha256`: lowercase SHA-256 digest of exact manifest file bytes
- `signature`: 64-byte Ed25519 signature over exact manifest bytes, unpadded base64url

Example invocation, from an independently secured verification environment:

```sh
node scripts/release-auth/verify.mjs verify \
  --manifest /release/manifest.json \
  --signature /release/manifest.sig.json \
  --trusted-key /trusted/off-origin/release-public.pem \
  --trusted-key-sha256 YOUR_EXTERNALLY_PINNED_64_HEX_FINGERPRINT \
  --minimum-sequence 1001
node --test scripts/release-auth/verify.test.mjs
```

Both the trusted PEM **and** its fingerprint must be supplied via independently authenticated channels. The release server must **not** set either trusted value or the monotonic minimum sequence. A trusted fingerprint alone does not authenticate a downloaded verifier. `VERIFIED_WITH_PROVIDED_ANCHOR` means only that the detached signature matched these supplied policy inputs.

## Fail-closed behavior and limitations

Rejects missing trust policy, wrong algorithm or key, malformed/noncanonical JSON, unsigned candidate, tampered manifest/signature, bad digest, and signed version rollback. Test keys are ephemeral and never persisted.

This module does **not** check individual JS/CSS/HTML/SW asset hashes: integrate #196's full manifest-to-dist verification separately before future activation. It does not persist the minimum release sequence, handle key rotation/revocation, secure first boot, manage a trusted previous SW or last-known-good cache, nor prevent a compromised same-origin page lying to the user.

**Do not enable Service Worker activation** or present an unconditional `Verified` badge based on this module. Independent anchor, protected signer, rotation policy, durable rollback state, secure bootstrap/atomic asset update, device acceptance and security review remain release gates.
