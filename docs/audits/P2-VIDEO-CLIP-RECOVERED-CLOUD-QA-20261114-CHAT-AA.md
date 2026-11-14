# P2 #376 — Video Editor newly encoded clip, recovered-device real cloud QA

- Agent: CHAT-AA; 2026-11-14 Asia/Tbilisi.
- Source: accepted `main@8ed66c438d090efd218efa80b027f0b2f854db4b` (contains #335 via #336).
- Unique test: `tests/e2e/p2-browser-video-clip-recovered-cloud-qa-chat-aa.spec.ts`.
- Scope: QA-only. No app source, cryptography, ACL or workflow mutations.

- Test collection: path `p2-browser-*.spec.ts` is explicitly included in `tests/playwright.config.ts`. The first attempted test name was not collected; no CI PASS on that earlier HEAD can count as acceptance.

## Why this test is necessary

Previous #215 UI E2E proved real browser encodes a bounded separate video while offline and stores the derivative in encrypted IndexedDB; it did not prove cloud durability, a different recovered device, or unrelated-account denial for the newly encoded file. Generic MediaFile E2EE and #206 audio derivative tests prove infrastructure but not this end-to-end video derivative.

## Acceptance path

1. SHA256-pinned independently decodable synthetic 32x32 VP8 source; register real owner device.
2. Real File Viewer Video Editor chooses 0.5–2.2s trim and native MediaRecorder produces local encrypted separate derivative while offline; original bytes and private metadata retained, derivative metadata not inherited.
3. Restore network, wait genuine server-signed manifest/chunk ACK and Synced states over disposable PostgreSQL18 + Garage; check server response does not expose private source name/description.
4. Independently recover same account in separate Chromium browser context B with NO shared IndexedDB; authenticate device, fetch ciphertext and manifest, verify SHA256 equality and native video decode, then open cloud File Viewer video.
5. Third unrelated account C cannot fetch derivative manifest (404) or list it. No OS gallery downloads.

## Evidence and scope limitations

- At creation: **CI NOT TESTED** on this branch; PASS can be claimed only after all exact-head workflows complete. Do not equate source #335 PASS with this test.
- Physical iOS Safari/Android, real hardware long recordings, frame-accuracy and MP4/EDL product policy: **NOT TESTED**.
- No production secrets, real personal data, external destinations, or destructive operations. Recovery key is transient in test memory and must not enter traces or attachments.
- No merge into `main` without explicit owner approval.