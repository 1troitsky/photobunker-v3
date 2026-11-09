#!/usr/bin/env python3
"""Export allowlisted, key-free metadata from one private acceptance run."""
import base64
import json
from pathlib import Path
import re
import statistics
import sys

run = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parents[2]
summary = json.loads((run / 'summary.json').read_text())


def normalize(value):
    if isinstance(value, str):
        return value.replace(str(root), '$REPO').replace(str(run), '$RUN_DIR')
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    return value


def specs(suite):
    yield from suite.get('specs', [])
    for child in suite.get('suites', []):
        yield from specs(child)


reports = {}
for name in ['product-e2e', 'acceptance-e2e', 'recovery-focused', 'performance-before', 'performance-after']:
    file = run / (name + '.json')
    if not file.exists():
        continue
    report = json.loads(file.read_text())
    tests = []
    for suite in report['suites']:
        for spec in specs(suite):
            for test in spec['tests']:
                entry = {'title': spec['title'], 'file': spec['file'], 'line': spec['line'],
                         'status': test['status'], 'results': []}
                for result in test['results']:
                    entry['results'].append({'status': result['status'], 'duration': result['duration']})
                    for attachment in result.get('attachments', []):
                        if attachment['name'] == 'production-navigation-timings':
                            if 'body' in attachment:
                                timings = json.loads(base64.b64decode(attachment['body']))
                            else:
                                timings = json.loads(Path(attachment['path']).read_text())
                            entry['timings'] = timings
                            entry['mediansMs'] = {
                                metric: statistics.median(sample[metric] for sample in timings['samples']
                                                          if sample[metric] is not None)
                                for metric in ['responseEnd', 'domContentLoaded', 'load']
                            }
                tests.append(entry)
    reports[name] = {'stats': report['stats'], 'tests': tests}

patterns = {
    'node': ('node-version', r'v22\.\d+\.\d+'),
    'pnpm': ('pnpm-version', r'(?m)^10\.20\.0$'),
    'php': ('php-security-floor', r'PHP security floor verified: ([\d.]+)'),
    'composer': ('composer-version', r'Composer version ([\d.]+)'),
    'postgresql': ('postgres-version', r'PostgreSQL\) ([\d.]+)'),
    'garage': ('garage-version', r'garage v([\d.]+)'),
    'playwright': ('playwright-version', r'Version ([\d.]+)'),
    'chromium': ('chromium-version', r'(?m)^(\d+\.\d+\.\d+\.\d+)$'),
}
versions = {}
for key, (log, pattern) in patterns.items():
    path = run / (log + '.log')
    match = re.search(pattern, path.read_text()) if path.exists() else None
    versions[key] = (match.group(1) if match.lastindex else match.group()) if match else 'NOT VERIFIED'

output = {'baseline': summary['base'], 'startedUtcEpoch': summary['started'],
          'versions': versions, 'checks': summary['results'], 'browsers': reports,
          'privacy': 'No raw traces, screenshots, credential files, request bodies, errors or user media exported.'}
print(json.dumps(normalize(output), ensure_ascii=False, indent=2))
