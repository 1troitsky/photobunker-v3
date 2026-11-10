# P1-17 — per-kind allowed categories and required tags

**Status: Draft / CI pending.** Stacked on P1-16 [PR #34](https://github.com/1troitsky/photobunker-v3/pull/34) at immutable `093a977caa9278491ed555661d6b0730ba8903e8`. Do not merge, deploy or alter `main`.

## User journey

1. Assignment owner configures three independent signed policy vocabularies, one each for photo, video and audio: **allowed categories** (empty = any category), and **required tag names** (empty = no required tags). These are human-readable labels in **public, owner-account-signed** policy v6. The editor explicitly warns that the *vocabulary itself* can be seen by the service and accepted participants. The user's **selected category and actual tags** are still private AEAD-encrypted metadata; individual selections are NEVER published in contracts or DB columns.
2. A category label is 1–64 UTF-8 bytes; up to 16 per type. A tag is 1–48 UTF-8 bytes; up to 12 required tags. Empty, duplicate, noncanonical, control-containing and comma-containing labels are rejected. Match is deliberately **case-sensitive**: e.g. `Evidence` and `evidence` differ. The editor takes comma-separated labels; delimiters cannot be embedded in a label.
3. Photo camera, audio and video MediaRecorder start **fail closed** if actual private metadata violate the signed list or omit any required tag. A failed check neither creates encrypted upload nor hands another account a DEK. Captures still begin offline from independently pinned owner-account signatures and are durable in the local encrypted outbox.
4. Photo AEAD private metadata supports **version 3** with optional canonical `tags:string[]`, retaining v1 (no private metadata) and v2 (category, description, GPS). MediaFile AEAD metadata similarly supports **version 3** while preserving v1/v2. File manifests, media upload contracts, receipt hashes and grant contracts retain their original public versions. The authenticated media metadata chunk is capped at **24 KiB** to fit the maximum 4000-character UTF-8 description (including multibyte characters) together with private tags and original filename. This bound is enforced by both client and API. Chosen tags are never persisted outside AEAD metadata ciphertext.
5. Personal media can optionally contain encrypted tags on import. A sender releasing a photo/media recipient grant first validates the *current* or historically bound owner-signed category/tag policy, actual locally decrypted AEAD metadata, and existing photo/media capture/scopes. The current photo pregrant flow preserves the existing verified policy-history and offline-cache behavior; audio/video pregrant requires live signed policy as before.
6. Owner receiving media grants can decrypt only via separately authorized E2EE grants. The server can enforce exact signed public vocabulary shapes, signatures, revisions, replay and ACL but **cannot inspect actual private fields**, verify a location, or establish genuine tags without trusting a cooperating client. A malicious modified contributor can lie about private fields; no server-side plaintext verification is claimed.

## Protocol v6 (additive / backwards compatible)

Domain: `pb3.assignment-policy.v6\n`, signature by owner ACCOUNT signing key. Exact v6 payload retains v5 fields and adds exactly:

```json
{
  "photoAdvanced": {"allowedCategories": ["Report"], "requiredTags": ["evidence"]},
  "videoAdvanced": {"allowedCategories": [], "requiredTags": []},
  "audioAdvanced": {"allowedCategories": ["Interview"], "requiredTags": ["recorded"]}
}
```

Rules must be present, exact, and canonically ordered; disabled media kinds must have both arrays empty. Old v1–v5 policies are always valid with default empty advanced rules. New edits always use v6; no downgrades. Private metadata revisions are **not** DB schema migrations; existing files keep their version.

## Test/evidence matrix

- PHPUnit: signed v6 canonicality, enabled/disabled-type limits, UTF-8, duplicate and malformed vocabulary rejection; exact signature, lost-ACK idempotence, v6-to-v5 downgrade refused, changed rule revision; existing media targets stay intact.
- Vitest: public canonical list parsing, no-case-fold matching, photo v3 and media v3 private metadata roundtrip, invalid tags/dedup, ciphertext-only manifest and restored legacy v1/v2; signed policy rules per kind and historical v6 photo preflight.
- Browser: two distinct accounts. Owner explicitly publishes strict audio category+required tag; contributor fails BEFORE recording for disallowed category/missing tags, then records and sends only after valid fields; owner decrypts tag from authorized AES-GCM media chunk. Video and previous receipts remain valid; local-first and E2EE still covered.
- CI: PHP 8.4/8.5, Vue typecheck/build, PostgreSQL 18/Garage 2.5, security floor and Playwright.

## Not in P1-17

- Cryptographic proof of media GPS, timestamp, or actual category/tag truth; no claim that the encrypted data can be validated by the backend.
- Encrypted *owner-private* rule vocabularies / per-contributor restricted taxonomy. If owner needs **private rule names themselves**, that needs separately shared encrypted policy delivery before using these public fields.
- Advanced Fieldwork four-tab editor parity, multimedia import retroactive tagging of existing ciphertext, edits to previously encrypted metadata, categories taxonomy localization, fuzzy matching, native iOS Safari QA, production deploy.
