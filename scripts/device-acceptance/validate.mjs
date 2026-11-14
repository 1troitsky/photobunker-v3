/**
 * PB3 Issue #217: metadata-shape gate for human-collected native PWA evidence.
 *
 * Deliberately NOT a mobile acceptance verifier: data can be self-reported,
 * device identity cannot be attested here, and evidence links are not examined.
 * A passing schema must never be promoted to a release PASS.
 */
import { readFileSync } from 'node:fs';

export const PLATFORMS = Object.freeze(['ios-safari-pwa', 'android-chrome-pwa']);

export const REQUIRED_SCENARIOS = Object.freeze([
  'welcome-recovery',
  'camera-permissions',
  'microphone-permissions',
  'gps-permissions',
  'gps-revocation',
  'photo-e2ee',
  'video-e2ee',
  'audio-e2ee',
  'editor-export',
  'browser-navigation',
  'dock-3-to-6',
  'dock-mandatory-profile',
  'keyboard-safe-area',
  'orientation',
  'fullscreen-back',
  'offline-warm-outbox',
  'offline-cold-start',
  'recovery-reload',
  'messages-fullscreen',
]);

const STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_TESTED']);
const SHA = /^[0-9a-f]{40}$/;
const SIMPLE_REF = /^docs\/audits\/[A-Za-z0-9_./-]+$/;

function nonempty(value, max = 256) {
  return typeof value === 'string' &&
    value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function safeEvidenceRef(value) {
  if (!nonempty(value, 1024)) return false;
  if (SIMPLE_REF.test(value) && !value.split('/').includes('..')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function utcDate(value) {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

/**
 * schemaValid means ONLY that evidence metadata is internally consistent.
 * independentDeviceAcceptance is intentionally always NOT_VERIFIED.
 */
export function validateDeviceEvidence(report, expectedSha) {
  const issues = [];
  const fail = (where, why) => issues.push(where + ': ' + why);
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_TESTED: 0 };
  if (!SHA.test(expectedSha ?? '')) fail('expectedSha', 'provide the exact lowercase 40-character commit SHA');
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    fail('report', 'expected an object');
    return { schemaValid: false, issues, counts, independentDeviceAcceptance: 'NOT_VERIFIED' };
  }
  if (report.schemaVersion !== 1) fail('schemaVersion', 'unsupported revision');
  if (report.testedSha !== expectedSha) fail('testedSha', 'must match the exact target commit SHA');
  if (!nonempty(report.collector, 128)) fail('collector', 'required human collector identifier');
  if (!Array.isArray(report.devices)) {
    fail('devices', 'expected an array');
    return { schemaValid: false, issues, counts, independentDeviceAcceptance: 'NOT_VERIFIED' };
  }
  if (report.devices.length !== PLATFORMS.length) {
    fail('devices', 'exactly one physical record per required platform');
  }
  for (const platform of PLATFORMS) {
    if (report.devices.filter(d => d?.platform === platform).length !== 1) {
      fail('devices', 'exactly one record required for ' + platform);
    }
  }
  report.devices.forEach((device, index) => {
    const at = 'devices[' + index + ']';
    if (!device || typeof device !== 'object' || Array.isArray(device)) {
      fail(at, 'expected an object');
      return;
    }
    if (!PLATFORMS.includes(device.platform)) fail(at + '.platform', 'unknown platform');
    if (device.physical !== true) fail(at + '.physical', 'physical hardware evidence required, no simulator');
    if (device.installationMode !== 'standalone') fail(at + '.installationMode', 'installed standalone PWA required');
    for (const field of ['model', 'osVersion', 'browserVersion']) {
      if (!nonempty(device[field], 128)) fail(at + '.' + field, 'required nonempty device metadata');
    }
    if (!utcDate(device.observedAt)) fail(at + '.observedAt', 'valid UTC timestamp required');
    if (device.testedSha !== expectedSha) fail(at + '.testedSha', 'must match exact release candidate');
    if (!Array.isArray(device.scenarios)) {
      fail(at + '.scenarios', 'expected an array');
      return;
    }
    const seen = new Set();
    device.scenarios.forEach((test, position) => {
      const loc = at + '.scenarios[' + position + ']';
      if (!test || typeof test !== 'object' || Array.isArray(test)) {
        fail(loc, 'expected an object');
        return;
      }
      if (!REQUIRED_SCENARIOS.includes(test.id)) fail(loc + '.id', 'unknown scenario');
      if (seen.has(test.id)) fail(loc + '.id', 'duplicate scenario');
      seen.add(test.id);
      if (!STATUSES.has(test.status)) {
        fail(loc + '.status', 'invalid status');
        return;
      }
      counts[test.status]++;
      if (test.status === 'PASS' || test.status === 'FAIL') {
        if (!safeEvidenceRef(test.evidenceRef)) fail(loc + '.evidenceRef', 'reviewable private-safe GitHub or docs/audits reference required');
      } else if (!nonempty(test.reason, 512)) {
        fail(loc + '.reason', 'BLOCKED and NOT_TESTED require an explanation');
      }
    });
    for (const required of REQUIRED_SCENARIOS) {
      if (!seen.has(required)) fail(at + '.scenarios', 'missing ' + required);
    }
  });
  return {
    schemaValid: issues.length === 0,
    issues,
    counts,
    independentDeviceAcceptance: 'NOT_VERIFIED',
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const [file, sha] = process.argv.slice(2);
  if (!file || !sha) {
    console.error('Usage: node scripts/device-acceptance/validate.mjs <evidence.json> <exact-40-char-SHA>');
    process.exitCode = 2;
  } else {
    try {
      const result = validateDeviceEvidence(JSON.parse(readFileSync(file, 'utf8')), sha);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.schemaValid ? 0 : 1;
    } catch (error) {
      console.error('Invalid evidence input: ' + error.message);
      process.exitCode = 1;
    }
  }
}
