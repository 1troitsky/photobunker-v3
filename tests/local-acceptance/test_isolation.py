"""Real Compose rendering under a polluted caller environment; no containers."""
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('acceptance', root / 'scripts/local-acceptance/run.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IsolationContract(unittest.TestCase):
    def test_caller_cannot_redirect_fixture_mounts_credentials_or_endpoints(self):
        acceptance = module.Acceptance()
        acceptance.compose_values = {
            'PB3_RUN_DIR': str(acceptance.directory), 'PB3_REPO_ROOT': str(root),
            'PB3_TEST_PASSWORD': 'disposable-contract-fixture',
            'PB3_TEST_APP_KEY': 'base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        }
        acceptance.save_env()
        try:
            with patch.dict(os.environ, {
                'PB3_RUN_DIR': '/must-not-be-used', 'PB3_REPO_ROOT': '/must-not-be-used',
                'PB3_TEST_PASSWORD': 'must-not-be-used',
                'DB_HOST': 'must-not-be-used', 'S3_ENDPOINT': 'https://must-not-be-used.invalid',
            }):
                ok, output = acceptance.dc('compose-isolation', 'config', '--format', 'json')
            self.assertTrue(ok)
            config = json.loads(output)
            self.assertEqual(config['name'], acceptance.project)
            postgres = config['services']['postgres']
            api = config['services']['api']
            self.assertEqual(postgres['environment']['POSTGRES_PASSWORD'], 'disposable-contract-fixture')
            self.assertEqual(api['environment']['DB_HOST'], '127.0.0.1')
            self.assertEqual(api['environment']['S3_ENDPOINT'], 'http://127.0.0.1:3900')
            mounts = {mount['target']: mount for mount in api['volumes']}
            self.assertEqual(mounts['/app']['source'], str(acceptance.directory / 'api'))
            self.assertEqual(mounts['/source']['source'], str(root))
            self.assertTrue(mounts['/source']['read_only'])
            self.assertNotIn('must-not-be-used', json.dumps(config))
            self.assertFalse(config.get('volumes'))
            self.assertEqual(postgres['ports'][0]['host_ip'], '127.0.0.1')
        finally:
            acceptance.cleanup()


if __name__ == '__main__':
    unittest.main()
