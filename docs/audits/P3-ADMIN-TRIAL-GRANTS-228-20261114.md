# P3 #228 — audited, atomic temporary admin entitlement · 2026-11-14

**Owner:** CHAT-K · **Own branch:** `feat/p3-228-admin-trial-grants-20261114`.
**READ-ONLY stacked parent:** #227 [Draft PR #318](https://github.com/1troitsky/photobunker-v3/pull/318) exact `60b3ca52a7cbe3e055cfa025abceeb71c00152e2`. Main remains `6565a0fe852882ea5fc26e493df81affed687eee`. Dependencies: #227 persistent AdminAuditLedger; existing main immutable Billing EntitlementLedger and AdminPolicy/MFA contract; #297 secure Laravel Composer lock still unmerged.

## Actual product-side code / exact scope

- `AdminTrialGrantExecutor::issueTrusted` implements **durable internal transaction**, not a controller: fresh owner/MFA policy, validated fixed reason and bounded grant, #227 global append-only audit record, immutable billing plan snapshot via `EntitlementLedger::advanceTrusted`, and own operation receipt in one transaction. Any conflict rolls back audit and billing. Real database writes: no synthetic success or fake in-memory plans.
- Exact same `operation_id` with identical payload replays without a new billing revision; different actor, plan, target, reason or expiry is rejected and cannot reinterpret an audited approval.
- New `admin_trial_grant_operations_v1` table ties operation, actor/target UUIDs, plan, expected revision, reason, trusted period, intent hash, audit digest and event hash to billing revision. No media, GPS, Recovery Key, IP, payment token or text fields.
- Only bounded temporary paid trials; no automatic Free/downgrade, payment, account/device/IP blocking, user-facing endpoint, admin authorization provider or session-minting. Strong server-originated `AdminPrincipal` is an **external prerequisite**; passing an object constructed from user-supplied role/MFA is NOT secure and MUST NOT be exposed.
- No mutations to parent #227 code/tests, existing Billing ledger, production routes/controllers, `main`, or parallel branch. No merge/deploy.

## Acceptance matrix

- Verified **code + original workflow HEAD** `bda7a91b6c803875d4e20e516a2c4a90d12d764b`, [dedicated GitHub Actions run #43554572411](https://github.com/1troitsky/photobunker-v3/actions/runs/43554572411): **PHP 8.4 and 8.5 both targeted 7/7 tests, 61 assertions PASS, full PHPUnit 261/261 tests, 3796 assertions PASS**; PHP floor/lint/composer install also PASS.
- **Overall dedicated workflow FAIL** only on `composer audit --locked` reporting one existing `laravel/framework` vulnerability, `CVE-2026-128083` / `GHSA-63hm-g96r-2m2q`, in the unpatched `main` Composer lock inherited through read-only #227 base. Tracked by separately owned #297 / Draft #298, no suppression or unapproved changes. This branch does not patch the lock.
- Same SHA P0 security-floor / UX scope guard workflow PASS. **All assertions are on test migrations using SQLite**; no independent PostgreSQL18 two-process race or external MFA principal integration is implied.
- Real independent PostgreSQL18 two-PHP-process row-lock races, actual deployed role grants/CSRF/step-up MFA and immutable external audit proof: **NOT TESTED / BLOCKED**.
- Full #228 scope (account/device/IP restrictions, NAT safeguards, unblock, privacy-safe analytics/admin UI): **NOT IMPLEMENTED**, remains separate future work.
- Issue #228 remains OPEN / IN PROGRESS / PARTIAL; Draft PR not merge-ready.

## No-go

Do not mount public route while independent trusted principal service and real MFA/CSRF/RBAC not accepted. Do not reclassify an AdminPrincipal DTO as actual authorization. Do not widen trial validity, suppress locked Composer Audit, or count draft code as final P3 acceptance. Original code+CI proof SHA `bda7a91b6c803875d4e20e516a2c4a90d12d764b`. Final documentation-only HEAD and its scoped CI are recorded with Issue/PR comments. #228 remains OPEN/in-progress.

## Two-process PostgreSQL18 acceptance extension — 2026-11-14

New exclusively owned `apps/api/tests/integration/p3-admin-trial-postgres-race.php` and scoped own workflow PG18 job. Each of four negative/positive races launches **two independent OS PHP processes and PDO PostgreSQL18 backends**; owner holds global audit head FOR UPDATE inside real transaction until contender attempts same DB; parent checks `pg_stat_activity.wait_event_type = Lock`, distinct PIDs and observed blocking time before accepting outcomes. Disposable-only guard checks GitHub Actions/testing/PDO pgsql, fixed DB hostname/user/schema and migration presence **before any test account creation**.

Scenarios: (1) exact Lost ACK replay same op: one audited grant and one billing snapshot, one receipt; (2) same operation ID changed plan denied (no upgrade); (3) distinct operations same expected account revision: second 409, its speculative audit rolled back; (4) different accounts receive distinct serialized audited grants. Final independent query validates verified global chain, 5 committed audit events, 5 durable receipts and immutable Free→paid billing heads with no duplicates/orphans. All IDs synthetic and data is disposable CI only.

PG job independently stages [pinned #297 security fix](https://github.com/1troitsky/photobunker-v3/pull/298) `60407676c7cb9bdb649f5017cf9450aff25eedab` Composer lock blob `c4bcae0458bd390b797186c3e2ccf536469588ef` only **inside runner**, verifies exact git blob SHA, requires `composer audit --locked` clean, migrates test PG18. Stacked PR branch and main's composer.lock stay unchanged; original PHP matrix will continue reporting inherited Composer CVE as explicit FAIL until #297 is approved. No mutation to parent #227's audit fixture or workflow, no merge/deploy and no HTTP admin routes.

**State:** code+CI added; real PG18 test outcome **NOT TESTED until exact SHA workflow finishes**. Do not claim acceptance from scripts alone.