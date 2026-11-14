import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDeviceEvidence,
  REQUIRED_SCENARIOS,
  PLATFORMS,
} from './validate.mjs';

// THESE ARE SYNTHETIC SCHEMA FIXTURES — NOT DEVICE MEASUREMENTS.
const HEAD = 'a'.repeat(40);
function fixture() {
  return {
    schemaVersion: 1,
    testedSha: HEAD,
    collector: 'schema-fixture-only',
    devices: PLATFORMS.map(platform => ({
      platform,
      physical: true, // untrusted claim; not verified by this tool
      installationMode: 'standalone',
      model: 'synthetic fixture (not a physical device)',
      osVersion: 'fixture',
      browserVersion: 'fixture',
      observedAt: '2026-11-14T00:00:00Z',
      testedSha: HEAD,
      scenarios: REQUIRED_SCENARIOS.map(id => ({
        id,
        status: 'NOT_TESTED',
        reason: 'No actual device was used by this synthetic fixture',
      })),
    })),
  };
}

test('only metadata validity: NEVER return device acceptance PASS', () => {
  const result = validateDeviceEvidence(fixture(), HEAD);
  assert.equal(result.schemaValid, true);
  assert.equal(result.independentDeviceAcceptance, 'NOT_VERIFIED');
  assert.equal(result.counts.NOT_TESTED, REQUIRED_SCENARIOS.length * 2);
  assert.equal(result.counts.PASS, 0);
});

test('even structurally complete PASS records never prove native acceptance', () => {
  const r = fixture();
  for (const d of r.devices) {
    for (const s of d.scenarios) {
      s.status = 'PASS';
      delete s.reason;
      s.evidenceRef = 'https://github.com/1troitsky/photobunker-v3/issues/217';
    }
  }
  const result = validateDeviceEvidence(r, HEAD);
  assert.equal(result.schemaValid, true);
  assert.equal(result.counts.PASS, REQUIRED_SCENARIOS.length * 2);
  assert.equal(result.independentDeviceAcceptance, 'NOT_VERIFIED');
});

test('missing platform is rejected', () => {
  const r = fixture();
  r.devices.pop();
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('duplicate platform cannot hide missing Android', () => {
  const r = fixture();
  r.devices[1].platform = 'ios-safari-pwa';
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('physical false and browser simulator are rejected', () => {
  const r = fixture();
  r.devices[0].physical = false;
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('browser tab is not an installed PWA', () => {
  const r = fixture();
  r.devices[1].installationMode = 'browser-tab';
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('stale SHA cannot masquerade as the tested release', () => {
  const r = fixture();
  r.devices[0].testedSha = 'b'.repeat(40);
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
  r.devices[0].testedSha = HEAD;
  r.testedSha = 'c'.repeat(40);
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('missing mobile scenario and duplicate scenarios are rejected', () => {
  const r = fixture();
  r.devices[0].scenarios.pop();
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
  r.devices[0].scenarios.push({ ...r.devices[0].scenarios[0] });
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('PASS without concrete evidence reference is rejected', () => {
  const r = fixture();
  r.devices[0].scenarios[0] = { id: REQUIRED_SCENARIOS[0], status: 'PASS' };
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('non-https and query-bearing evidence references are rejected', () => {
  const r = fixture();
  const s = r.devices[0].scenarios[0];
  s.status = 'FAIL';
  s.evidenceRef = 'http://example.com/case';
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
  s.evidenceRef = 'https://github.com/example/repo/issues/1?token=secret';
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('NOT_TESTED/BLOCKED without explicit explanation are rejected', () => {
  const r = fixture();
  delete r.devices[0].scenarios[0].reason;
  r.devices[1].scenarios[0].status = 'BLOCKED';
  r.devices[1].scenarios[0].reason = '';
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('invalid UTC timestamp and version are rejected', () => {
  const r = fixture();
  r.devices[1].observedAt = '2026-02-30T00:00:00Z';
  r.schemaVersion = 5;
  assert.equal(validateDeviceEvidence(r, HEAD).schemaValid, false);
});

test('malformed inputs fail closed', () => {
  assert.equal(validateDeviceEvidence(null, HEAD).schemaValid, false);
  assert.equal(validateDeviceEvidence({ schemaVersion: 1, devices: null }, HEAD).schemaValid, false);
  assert.equal(validateDeviceEvidence(fixture(), 'not-a-sha').schemaValid, false);
});
