#!/usr/bin/env python3
"""Round 2 against an explicitly pinned checkout; no copying QA into product."""
import argparse
from pathlib import Path
import re
import subprocess

from run import Acceptance, ROOT

QA_BASE = '5d6116ae222b0694344f42f2b9a8d5a853682dc4'


class Round2(Acceptance):
    def __init__(self, browser_suite='all', **kwargs):
        super().__init__(**kwargs)
        self.browser_suite = browser_suite

    def browser(self, name, config, *extra):
        return self.command(name, ['pnpm', 'exec', 'playwright', 'test', '--config', str(config),
                            '--output', str(self.directory / name), '--reporter=line,json', *extra],
                            env={'PLAYWRIGHT_JSON_OUTPUT_NAME': str(self.directory / (name + '.json'))},
                            cwd=self.source_root if name == 'product-e2e' else ROOT, timeout=1200)[0]

    def browsers(self):
        if not self.command('chromium-install', ['pnpm', 'exec', 'playwright', 'install', 'chromium'])[0]:
            self.skip('browser-tests', 'Chromium unavailable')
            return
        self.command('playwright-version', ['pnpm', 'exec', 'playwright', '--version'])
        self.command('chromium-version', ['node', '--input-type=module', '-e',
                     'import {chromium} from "@playwright/test"; const b=await chromium.launch(); '
                     'console.log(b.version()); await b.close();'])
        self.background('vite', ['pnpm', '--filter', '@pb3/web', 'exec', 'vite',
                                 '--host', '127.0.0.1', '--port', '5173', '--strictPort'], cwd=self.source_root)
        self.background('preview', ['pnpm', '--filter', '@pb3/web', 'exec', 'vite',
                                    'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], cwd=self.source_root)
        if not self.health('vite-ready', 'http://127.0.0.1:5173/settings'):
            self.skip('browser-tests', 'Vite unavailable')
            return
        preview = self.health('preview-ready', 'http://127.0.0.1:4173/settings')
        config = ROOT / 'tests/local-acceptance/playwright.config.ts'
        if self.browser_suite != 'all':
            if self.browser_suite == 'product':
                self.browser('product-e2e', self.source_root / 'tests/playwright.config.ts')
            elif self.browser_suite in ('state', 'late-capture'):
                self.browser('state-integration', config, 'state-integration.spec.ts', '--max-failures', '2')
                if self.browser_suite == 'late-capture':
                    self.php('state-timestamps', 'php', '-r',
                        "if (getenv('APP_ENV')!=='testing'||getenv('DB_DATABASE')!=='pb3_ci_p0'||getenv('PB3_ISOLATED_STORAGE_SMOKE')!=='1') exit(1); "
                        "require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); "
                        "$rows=Illuminate\\Support\\Facades\\DB::table('assignment_state_events_v1')->orderBy('created_at')->limit(100)->get(['assignment_id','from_revision','to_revision','state','created_at']); "
                        "echo json_encode($rows,JSON_THROW_ON_ERROR),PHP_EOL;")
                if self.browser_suite == 'state':
                    self.browser('camera-reload', config, 'camera-reload.spec.ts', '--max-failures', '1')
            elif self.browser_suite == 'lost-ack':
                self.browser('lost-ack-stability', config, 'resilience.spec.ts', '--grep',
                             'ciphertext survives', '--repeat-each', '3', '--max-failures', '2')
            self.skip('other-browser-suites', 'Targeted --browser-suite=' + self.browser_suite)
            return
        if preview:
            self.browser('performance-before', config, 'performance.spec.ts')
        self.browser('product-e2e', self.source_root / 'tests/playwright.config.ts')
        # Fixed three requested stability samples; no retries or loop-until-green.
        self.browser('lost-ack-stability', config, 'resilience.spec.ts',
                     '--grep', 'ciphertext survives', '--repeat-each', '3', '--max-failures', '2')
        self.browser('acceptance-e2e', config, 'resilience.spec.ts', '--grep-invert',
                     'ciphertext survives|cold offline reload')
        if (self.source_root / 'docs/planning/P1-04-SIGNED-STATE.md').exists():
            self.browser('state-integration', config, 'state-integration.spec.ts', '--max-failures', '2')
            self.browser('camera-reload', config, 'camera-reload.spec.ts', '--max-failures', '1')
        else:
            self.skip('state-integration', 'Signed state transitions are absent from the QA baseline')
        if preview:
            self.browser('offline-readiness', config, 'offline-readiness.spec.ts')
        self.command('safari', ['python3', str(ROOT / 'scripts/local-acceptance/safari-smoke.py'),
                              str(self.directory)], timeout=180, optional=True)
        if preview:
            self.browser('performance-after', config, 'performance.spec.ts')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--source-ref', default=QA_BASE)
    parser.add_argument('--browser-suite', choices=['all', 'product', 'state', 'late-capture', 'lost-ack'], default='all')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.source_ref):
        parser.error('--source-ref must be a full immutable commit SHA')
    # Require that the supplied checkout is actually at the tested commit;
    # do not fetch, switch, merge or update product branches inside the harness.
    head = subprocess.check_output(['git', '-C', str(args.source_root), 'rev-parse', 'HEAD'], text=True).strip()
    if args.source_root.resolve() != ROOT and head != args.source_ref:
        parser.error('Worktree HEAD does not match --source-ref')
    acceptance = Round2(**vars(args))
    try:
        acceptance.run()
    except (Exception, KeyboardInterrupt) as error:
        acceptance.results.append({'name': 'runner', 'status': 'FAIL', 'exit_code': 1, 'reason': str(error)})
        print(f'Runner interrupted: {error}', flush=True)
    finally:
        acceptance.cleanup()
    print(f'Summary: {acceptance.directory / "summary.json"}', flush=True)
    raise SystemExit(1 if any(r['status'] == 'FAIL' for r in acceptance.results) else 0)
