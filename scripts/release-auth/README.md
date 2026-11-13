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

## Optional externally trusted release checkpoint

A trusted minimum release sequence prevents old-version rollback but does **not** rule out a second, differently signed manifest reusing exactly the same sequence. When an independently authenticated previous release receipt is available, pass **both** its release sequence and exact manifest SHA-256:

```sh
node scripts/release-auth/verify.mjs verify \
  --manifest /release/manifest.json \
  --signature /release/manifest.sig.json \
  --trusted-key /trusted/off-origin/release-public.pem \
  --trusted-key-sha256 YOUR_EXTERNALLY_PINNED_64_HEX_FINGERPRINT \
  --minimum-sequence 1001 \
  --trusted-checkpoint-sequence 1001 \
  --trusted-checkpoint-sha256 YOUR_EXTERNALLY_TRUSTED_PREVIOUS_MANIFEST_HASH
```

The verifier then rejects any signed release below the checkpoint sequence (`ROLLBACK`) **and** a different signed manifest at the same sequence (`RELEASE_EQUIVOCATION`). A greater sequence is permitted, but this build-time verifier **does not persist or authorize a new checkpoint**: that requires external trusted approval and atomic durable storage outside mutable same-origin client state. An attacker-controlled checkpoint is meaningless. Checkpoint arguments must be supplied together; omitting either fails closed.

## Fail-closed behavior and limitations

Rejects missing trust policy, wrong algorithm or key, malformed/noncanonical JSON, unsigned candidate, tampered manifest/signature, bad digest, signed version rollback, and **invalid #196 manifest v1 structure** (required build metadata, non-empty unique sorted asset inventory, safe relative paths, asset metadata, and consistent Service Worker reference). The schema is independently mirrored here because #196 remains a separate unmerged Draft PR; a future integration must test both implementations against identical fixtures. Test keys are ephemeral and never persisted.

This module does **not** check individual JS/CSS/HTML/SW asset hashes: integrate #196's full manifest-to-dist verification separately before future activation. It does not persist the minimum release sequence, handle key rotation/revocation, secure first boot, manage a trusted previous SW or last-known-good cache, nor prevent a compromised same-origin page lying to the user.

**Do not enable Service Worker activation** or present an unconditional `Verified` badge based on this module. Independent anchor, protected signer, rotation policy, durable rollback state, secure bootstrap/atomic asset update, device acceptance and security review remain release gates.
