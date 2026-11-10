#!/usr/bin/env python3
"""Disposable PB3 acceptance. Python standard library; no LLM or user data."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BASE = 'e72c350d8926bcac17c515acef6eb1dc884c6206'


class Acceptance:
    def __init__(self, frontend_only=False, source_root=ROOT, source_ref=BASE):
        self.frontend_only = frontend_only
        self.source_root = Path(source_root).resolve()
        self.source_ref = source_ref
        self.directory = Path(tempfile.mkdtemp(prefix='pb3-acceptance-'))
        self.directory.chmod(0o700)
        self.results = []
        self.processes = []
        self.project = 'pb3-accept-' + secrets.token_hex(5)
        self.env_file = self.directory / 'compose.env'
        self.compose = ['docker', 'compose', '--project-name', self.project,
                        '--env-file', str(self.env_file), '-f',
                        str(ROOT / 'scripts/local-acceptance/compose.yml')]
        self.secrets = []
        self.compose_started = False
        self.started = time.time()
        print(f'Artifacts (private, do not commit): {self.directory}', flush=True)

    def write_summary(self):
        (self.directory / 'summary.json').write_text(json.dumps({
            'base': self.source_ref, 'source_root': str(self.source_root),
            'qa_root': str(ROOT), 'project': self.project, 'started': self.started,
            'results': self.results,
        }, indent=2) + '\n')

    def skip(self, name, reason):
        self.results.append({'name': name, 'status': 'NOT TESTED', 'reason': reason,
                             'command': None, 'exit_code': None})
        self.write_summary()
        print(f'NOT TESTED {name}: {reason}', flush=True)

    def command(self, name, args, *, cwd=ROOT, timeout=600, private=False, env=None,
                optional=False):
        args = [str(arg) for arg in args]
        logfile = self.directory / (name + '.log')
        print(f'RUN {name}', flush=True)
        start = time.monotonic()
        output = ''
        try:
            proc = subprocess.Popen(args, cwd=cwd, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True,
                                    env={**os.environ, **(env or {})}, start_new_session=True)
            try:
                output, _ = proc.communicate(timeout=timeout)
                code = proc.returncode
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    output, _ = proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    output, _ = proc.communicate()
                code = 124
        except OSError as error:
            code, output = 127, str(error)
        safe_output = '[private fixture credentials omitted]\n' if private else output
        for secret in self.secrets:
            safe_output = safe_output.replace(secret, '[redacted]')
        logfile.write_text('$ ' + shlex.join(args) + '\n' + safe_output)
        status = 'PASS' if code == 0 else ('NOT TESTED' if optional and code == 77 else 'FAIL')
        self.results.append({'name': name, 'status': status, 'exit_code': code,
                             'command': args, 'cwd': str(cwd), 'log': str(logfile),
                             'seconds': round(time.monotonic() - start, 3)})
        self.write_summary()
        print(f'{status} {name} (exit {code}; {logfile})', flush=True)
        if code and not private:
            print(safe_output[-2000:], flush=True)
        return code == 0, output

    def dc(self, name, *args, **kwargs):
        # Process environment normally outranks --env-file in Compose. Always
        # pin fixture variables so a caller's PB3_* cannot redirect mounts/data.
        kwargs['env'] = {**getattr(self, 'compose_values', {}), **kwargs.pop('env', {})}
        return self.command(name, self.compose + list(args), **kwargs)

    def php(self, name, *args, **kwargs):
        return self.dc(name, 'run', '--rm', '--no-deps', 'api', *args, **kwargs)

    def background(self, name, args, cwd=ROOT):
        logfile = self.directory / (name + '.log')
        with logfile.open('w') as output:
            proc = subprocess.Popen(args, cwd=cwd, stdout=output, stderr=subprocess.STDOUT,
                                    start_new_session=True)
        self.processes.append(proc)

    @staticmethod
    def available(port):
        try:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False

    def health(self, name, url, timeout=45):
        # Recorded as an actual reproducible HTTP command, including exit code.
        code = ('import time,urllib.request,sys\n'
                f'deadline=time.monotonic()+{timeout}\n'
                'while time.monotonic()<deadline:\n'
                ' try:\n'
                f'  response=urllib.request.urlopen({url!r},timeout=2)\n'
                '  print(response.status); sys.exit(0)\n'
                ' except Exception: time.sleep(1)\n'
                'sys.exit(1)\n')
        return self.command(name, [shutil.which('python3'), '-c', code], timeout=timeout+5)[0]

    def provision(self):
        script = (ROOT / 'scripts/local-acceptance/compose.yml').exists()
        assert script
        runtime = self.directory / 'api'
        shutil.copytree(self.source_root / 'apps/api', runtime,
                        ignore=shutil.ignore_patterns('vendor', '.env', '.env.*', '.phpunit.cache'))
        password = secrets.token_hex(24)
        app_key = 'base64:' + base64.b64encode(secrets.token_bytes(32)).decode()
        self.secrets.extend([password, app_key])
        self.compose_values = {
            'PB3_RUN_DIR': str(self.directory), 'PB3_REPO_ROOT': str(self.source_root),
            'PB3_TEST_PASSWORD': password, 'PB3_TEST_APP_KEY': app_key,
        }
        self.save_env()
        (self.directory / 'garage.toml').write_text(
            'metadata_dir = "/var/lib/garage/meta"\n'
            'data_dir = "/var/lib/garage/data"\n'
            'db_engine = "sqlite"\nreplication_factor = 1\n'
            'rpc_bind_addr = "127.0.0.1:3901"\n'
            'rpc_public_addr = "127.0.0.1:3901"\n'
            f'rpc_secret = "{secrets.token_hex(32)}"\n'
            '[s3_api]\ns3_region = "garage"\napi_bind_addr = "0.0.0.0:3900"\n')
        if not self.dc('compose-build', 'build', 'api', timeout=1200)[0]:
            return False
        if not self.command('php-security-floor', ['docker', 'run', '--rm', '--network', 'none',
                '-v', f'{self.source_root}:/source:ro', 'pb3-local-acceptance-php:8.4.27',
                'php', '/source/scripts/check-runtime.php'])[0]:
            return False
        self.compose_started = True
        if not self.dc('storage-up', 'up', '-d', '--wait', 'postgres', 'garage')[0]:
            return False
        self.dc('postgres-version', 'exec', '-T', 'postgres', 'postgres', '--version')
        self.dc('garage-version', 'exec', '-T', 'garage', '/garage', '--version')
        for attempt in range(30):
            node = subprocess.run(self.compose + ['exec', '-T', 'garage', '/garage', 'node', 'id', '-q'],
                                  capture_output=True, text=True, timeout=10,
                                  env={**os.environ, **self.compose_values})
            if node.returncode == 0:
                break
            time.sleep(1)
        else:
            self.skip('garage-provision', 'Garage did not become ready')
            return False
        node_id = node.stdout.strip().split('@')[0]
        for name, args in [
            ('garage-assign', ['layout', 'assign', '-z', 'ci-zone', '-c', '1G', node_id]),
            ('garage-layout', ['layout', 'apply', '--version', '1']),
            ('garage-bucket', ['bucket', 'create', 'pb3-ci-p0']),
        ]:
            if not self.dc(name, 'exec', '-T', 'garage', '/garage', *args)[0]:
                return False
        ok, output = self.dc('garage-key', 'exec', '-T', 'garage', '/garage',
                             'key', 'create', 'pb3-ci-key', private=True)
        if not ok:
            return False
        values = {}
        for line in output.splitlines():
            if line.strip().startswith(('Key ID:', 'Secret key:')):
                key, value = line.strip().split(':', 1)
                values[key] = value.strip()
        if not values.get('Key ID') or not values.get('Secret key'):
            self.skip('garage-credentials', 'Cannot parse Garage key output; no secrets logged')
            return False
        self.secrets.extend(values.values())
        self.compose_values.update(PB3_TEST_S3_KEY=values['Key ID'], PB3_TEST_S3_SECRET=values['Secret key'])
        self.save_env()
        return self.dc('garage-allow', 'exec', '-T', 'garage', '/garage', 'bucket', 'allow',
                       '--read', '--write', '--owner', 'pb3-ci-p0', '--key', 'pb3-ci-key')[0]

    def save_env(self):
        # No caller-supplied DB/S3 variables can select existing environments.
        self.env_file.write_text(''.join(f'{key}={json.dumps(value)}\n'
                                         for key, value in self.compose_values.items()))
        self.env_file.chmod(0o600)

    def browsers(self):
        if not self.command('chromium-install', ['pnpm', 'exec', 'playwright', 'install', 'chromium'])[0]:
            self.skip('browser-tests', 'Chromium installation unavailable')
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
            self.skip('browser-tests', 'Vite not ready')
            return
        preview = self.health('preview-ready', 'http://127.0.0.1:4173/settings')
        def browser(name, config, extra=()):
            if name == 'product-e2e':
                config = self.source_root / 'tests/playwright.config.ts'
            return self.command(name, ['pnpm', 'exec', 'playwright', 'test', '--config', config,
                                      '--output', str(self.directory / name), '--reporter=line,json', *extra],
                                env={'PLAYWRIGHT_JSON_OUTPUT_NAME': str(self.directory / (name + '.json')),
                                     'PB3_ACCEPTANCE_ARTIFACTS': str(self.directory)},
                                cwd=self.source_root if name == 'product-e2e' else ROOT, timeout=1200)[0]
        config = 'tests/local-acceptance/playwright.config.ts'
        if preview:
            browser('performance-before', config, ['performance.spec.ts'])
        browser('product-e2e', 'tests/playwright.config.ts')
        browser('acceptance-e2e', config, ['resilience.spec.ts'])
        self.command('safari', ['python3', 'scripts/local-acceptance/safari-smoke.py', str(self.directory)],
                     timeout=90, optional=True)
        if preview:
            browser('performance-after', config, ['performance.spec.ts'])

    def run(self):
        self.command('git-head', ['git', 'log', '-1', '--format=%H %s'], cwd=self.source_root)
        baseline = self.command('source-boundaries', ['git', 'diff', '--exit-code', self.source_ref, '--',
                                'apps/api', 'apps/web', 'tests/e2e', 'tests/playwright.config.ts',
                                'package.json', 'pnpm-lock.yaml', 'compose.p0.yml'], cwd=self.source_root)[0]
        node_ok = self.command('node-version', ['node', '--version'])[0]
        self.command('pnpm-version', ['pnpm', '--version'])
        deps = self.command('pnpm-install', ['pnpm', 'install', '--frozen-lockfile'], cwd=self.source_root)[0] if node_ok else False
        if deps:
            self.command('typecheck', ['pnpm', 'typecheck'], cwd=self.source_root)
            self.command('vitest', ['pnpm', 'test:web'], cwd=self.source_root)
            self.command('production-build', ['pnpm', 'build'], cwd=self.source_root)
        if self.frontend_only:
            self.skip('backend-and-browser', '--frontend-only requested')
            return
        if not baseline:
            self.skip('backend-and-browser', 'Protected source differs from the pinned acceptance baseline')
            return
        if not all(self.available(port) for port in (8000, 5173, 4173)):
            self.command('port-conflict', ['python3', '-c',
                'raise SystemExit("Ports 8000, 5173, 4173 must be free; existing processes were not stopped")'])
            self.skip('backend-and-browser', 'Reserved port in use; refusing to contact existing application')
            return
        if not self.command('docker-version', ['docker', 'version'])[0]:
            self.skip('backend-and-browser', 'Docker unavailable')
            return
        if not self.command('isolation-contract', ['python3', '-B', 'tests/local-acceptance/test_isolation.py'])[0]:
            self.skip('backend-and-browser', 'Compose isolation contract failed; refusing container creation')
            return
        if not self.provision():
            self.command('setup-incomplete', ['python3', '-c',
                         'raise SystemExit("Isolated storage/runtime setup failed; see preceding logs")'])
            self.skip('backend-and-browser', 'Isolated storage/runtime setup failed; see setup logs')
            return
        self.command('image-digests', ['docker', 'image', 'inspect',
                     'php:8.4.27-cli-bookworm', 'postgres:18-alpine', 'dxflrs/garage:v2.5.0',
                     '--format', '{{json .RepoTags}} {{json .RepoDigests}}'])
        if not self.php('composer-install', 'composer', 'install', '--no-interaction',
                        '--no-progress', '--prefer-dist', timeout=900)[0]:
            self.skip('php-and-browser', 'Composer dependencies unavailable')
            return
        self.php('composer-version', 'composer', '--version')
        self.php('composer-validate', 'composer', 'validate', '--strict', '--no-check-publish')
        self.php('plan-registry', 'php', '/source/scripts/verify-plan-config.php')
        self.php('php-lint', 'sh', '-c',
                 "find app bootstrap config routes database tests /source/scripts -name '*.php' -type f -print0 | xargs -0 -n1 php -l")
        self.php('routes', 'php', 'artisan', 'route:list')
        # Do not inherit Compose's HTTP origin, PostgreSQL or S3 environment:
        # PHP's $_SERVER can take precedence over PHPUnit's forced $_ENV.
        # Match the CI unit job and make external database access impossible.
        self.command('phpunit', ['docker', 'run', '--rm', '--network', 'none',
                     '-v', f'{self.directory / "api"}:/app',
                     'pb3-local-acceptance-php:8.4.27', 'php', 'vendor/bin/phpunit',
                     '--log-junit', '/app/phpunit-junit.xml'])
        if not self.php('migrate', 'php', 'artisan', 'migrate', '--force')[0]:
            self.skip('integration-and-browser', 'Disposable database migration failed')
            return
        self.php('garage-postgres-smoke', 'php', 'tests/integration/garage-postgres-smoke.php')
        self.php('lifecycle-garage-smoke', 'php', 'tests/integration/lifecycle-garage-smoke.php')
        if self.dc('api-up', 'up', '-d', 'api')[0] and self.health('healthz', 'http://127.0.0.1:8000/api/healthz'):
            self.health('readyz', 'http://127.0.0.1:8000/api/readyz')
            if deps:
                self.browsers()

    def cleanup(self):
        for process in reversed(self.processes):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
        if self.compose_started:
            self.dc('container-logs', 'logs', '--no-color', timeout=60)
            # Only containers/network created with this unique project name.
            # No prune, rm -v, down -v, database reset, or existing-container stop.
            self.dc('isolated-cleanup', 'down', '--remove-orphans', timeout=90)
        self.write_summary()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend-only', action='store_true')
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--source-ref', default=BASE)
    acceptance = Acceptance(**vars(parser.parse_args()))
    try:
        acceptance.run()
    except (Exception, KeyboardInterrupt) as error:
        acceptance.results.append({'name': 'runner', 'status': 'FAIL', 'exit_code': 1,
                                   'reason': str(error)})
        print(f'Runner interrupted: {error}', flush=True)
    finally:
        acceptance.cleanup()
    print(f'Summary: {acceptance.directory / "summary.json"}', flush=True)
    raise SystemExit(1 if any(r['status'] == 'FAIL' for r in acceptance.results) else 0)
