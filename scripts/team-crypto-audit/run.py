#!/usr/bin/env python3
"""Independent, exact-HEAD Teams audit; disposable PostgreSQL/Garage only."""
import argparse, importlib.util, json, os, subprocess, sys, shutil, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = 'ff9c7bab2485c7d2cfd094e67fdb505a1221ee00'
spec = importlib.util.spec_from_file_location('acceptance', ROOT / 'scripts/local-acceptance/run.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Audit(module.Acceptance):
    def focused(self):
        if not self.command('source-boundaries', ['git', 'diff', '--exit-code', self.source_ref], cwd=self.source_root)[0]:
            return
        if not all(self.available(p) for p in (8000, 5173, 4173)):
            raise RuntimeError('Fixture ports occupied')
        if not self.command('isolation-contract', ['python3', '-B', 'tests/local-acceptance/test_isolation.py'])[0]:
            return
        if not self.provision():
            return
        if not self.php('composer-install', 'composer', 'install', '--no-interaction', '--no-progress', '--prefer-dist', timeout=900)[0]:
            return
        if not self.php('migrate', 'php', 'artisan', 'migrate', '--force')[0]:
            return
        if self.dc('api-up', 'up', '-d', 'api')[0] and self.health('readyz', 'http://127.0.0.1:8000/api/readyz'):
            self.browsers()

    def browsers(self):
        shutil.copy2(ROOT/'scripts/team-crypto-audit/fixture.php',self.directory/'api/audit-fixture.php')
        if not self.focused_only:
            if self.command('php85-build',['docker','build','-t','pb3-team-audit-php:8.5.12','-f',str(ROOT/'scripts/team-crypto-audit/Dockerfile.php85'),str(ROOT/'scripts/team-crypto-audit')],timeout=900)[0]:
                if not self.command('php85-security-floor',['docker','run','--rm','--network','none','-v',f'{self.source_root}:/source:ro','pb3-team-audit-php:8.5.12','php','/source/scripts/check-runtime.php'])[0]:
                    raise RuntimeError('PHP 8.5 security floor rejected; stop')
                self.command('phpunit85',['docker','run','--rm','--network','none','-v',f'{self.directory/"api"}:/app','pb3-team-audit-php:8.5.12','php','vendor/bin/phpunit','--log-junit','/app/phpunit85-junit.xml'])
            else:
                self.skip('phpunit85','QA image build failed; no PHP 8.5 test was run')
        link = ROOT / 'node_modules'
        if not link.exists():
            link.symlink_to(self.source_root / 'node_modules', target_is_directory=True)
            self.created_link = True
        self.command('os-version', ['sw_vers'])
        self.command('playwright-version', ['pnpm', 'exec', 'playwright', '--version'])
        self.command('chromium-version', ['node', '--input-type=module', '-e',
            'import {chromium} from "@playwright/test"; const b=await chromium.launch(); console.log(b.version()); await b.close()'])
        self.background('vite', ['pnpm', '--filter', '@pb3/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], cwd=self.source_root)
        if not self.health('vite-ready', 'http://127.0.0.1:5173/settings'):
            return
        if getattr(self, 'diagnose_media', False):
            reference = ROOT / 'tests/team-crypto-audit/media-reference'
            if reference.exists():
                raise RuntimeError('Media reference directory already exists; refusing overwrite')
            reference.mkdir()
            for name in ['p1-assignment-media.spec.ts', 'p1-media.spec.ts']:
                source = (self.source_root / 'tests/e2e' / name).read_text()
                source, replacements = re.subn(r"^import\s*\{\s*test\s*,\s*expect\s*\}\s*from\s*['\"]@playwright/test['\"]",
                    "import { test, expect } from '../instrumented'", source, count=1, flags=re.MULTILINE)
                if replacements != 1:
                    raise RuntimeError('Media test fixture import was not replaced exactly once')
                (reference / name).write_text(source)
            try:
                self.command('media-diagnostic', ['pnpm', 'exec', 'playwright', 'test', '--config', 'tests/team-crypto-audit/media.config.ts',
                    '--output', str(self.directory / 'media-diagnostic'), '--reporter=line,json'], timeout=600,
                    env={'PB3_ACCEPTANCE_ARTIFACTS':str(self.directory),'PLAYWRIGHT_JSON_OUTPUT_NAME':str(self.directory/'media-diagnostic.json')})
            finally:
                shutil.rmtree(reference)
        if not getattr(self, 'focused_only', False):
            self.command('product-e2e', ['pnpm', 'exec', 'playwright', 'test', '--config', 'tests/playwright.config.ts',
                '--output', str(self.directory / 'product-e2e'), '--reporter=line,json'], cwd=self.source_root, timeout=1200,
                env={'PLAYWRIGHT_JSON_OUTPUT_NAME': str(self.directory / 'product-e2e.json')})
        self.command('independent-team-audit', ['pnpm', 'exec', 'playwright', 'test', '--config', 'tests/team-crypto-audit/playwright.config.ts',
            '--output', str(self.directory / 'independent-team-audit'), '--reporter=line,json'], timeout=900,
            env={'PB3_ACCEPTANCE_ARTIFACTS': str(self.directory), 'PLAYWRIGHT_JSON_OUTPUT_NAME': str(self.directory / 'independent-team-audit.json')})
        self.privacy()
        self.command('product-source-after', ['git', 'diff', '--exit-code', self.source_ref], cwd=self.source_root)

    def privacy(self):
        canaries = self.directory / 'private-canaries.json'
        if not canaries.exists():
            self.skip('privacy-canaries', 'Independent journey did not produce canaries')
            return
        values = json.loads(canaries.read_text())
        ok, dump = self.dc('private-database-scan', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'pb3_ci', '--data-only', 'pb3_ci_p0', private=True)
        logs = subprocess.run(self.compose + ['logs', '--no-color'], env={**os.environ, **self.compose_values}, capture_output=True, text=True, timeout=40)
        result = {'databaseScanned': ok, 'containerLogExit': logs.returncode,
            'databaseCanariesAbsent': all(v not in dump for v in values),
            'logCanariesAbsent': all(v not in logs.stdout for v in values)}
        path = self.directory / 'privacy-scan.json'
        path.write_text(json.dumps(result))
        self.command('privacy-canary-check', ['python3', '-c',
            'import json,sys;x=json.load(open(sys.argv[1]));print(json.dumps(x));assert x["databaseScanned"] and x["databaseCanariesAbsent"] and x["logCanariesAbsent"] and x["containerLogExit"]==0', str(path)])

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root', required=True, type=Path)
    p.add_argument('--target-ref', default=TARGET, help='Exact #56 or its separately committed fix descendant')
    p.add_argument('--focused', action='store_true', help='Fresh fixture, independent audit only; retain prior full-suite results')
    p.add_argument('--diagnose-media', action='store_true', help='One instrumented recheck of unchanged existing media scenarios')
    args = p.parse_args()
    if not re.fullmatch('[a-f0-9]{40}',args.target_ref):
        p.error('Target must be a full immutable SHA')
    if subprocess.check_output(['git', '-C', str(args.source_root), 'rev-parse', 'HEAD'], text=True).strip() != args.target_ref:
        p.error('Product HEAD mismatch')
    if subprocess.run(['git','-C',str(args.source_root),'merge-base','--is-ancestor',TARGET,args.target_ref]).returncode:
        p.error('Target must descend from audited PR #56')
    if not (ROOT / 'tests/team-crypto-audit/teams.spec.ts').is_file():
        p.error('Independent test source missing; provision only complete QA sources')
    a = Audit(source_root=args.source_root, source_ref=args.target_ref)
    a.focused_only = args.focused
    a.diagnose_media = args.diagnose_media
    try:
        if args.focused:
            a.focused()
        else:
            a.run()
    except (Exception, KeyboardInterrupt) as e:
        a.results.append({'name': 'runner', 'status': 'FAIL', 'exit_code': 1, 'reason': str(e)})
        print('Runner interrupted:', e, flush=True)
    finally:
        a.cleanup()
        if getattr(a, 'created_link', False):
            (ROOT / 'node_modules').unlink()
    print('Summary:', a.directory / 'summary.json', flush=True)
    sys.exit(1 if any(x['status'] == 'FAIL' for x in a.results) else 0)
