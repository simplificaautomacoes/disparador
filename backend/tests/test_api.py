"""Rotas reais em ASGI, banco temporário e APIs de envio simuladas."""
import importlib.util
import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import database
import auth
from fastapi.testclient import TestClient


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(dir=Path(database.DATA_DIR).resolve())
        cls.stack = ExitStack()
        cls.stack.enter_context(patch.object(database, 'DB_FILE', str(Path(cls.work.name) / 'api.db')))
        cls.stack.enter_context(patch.object(auth, 'USERS_FILE', str(Path(cls.work.name) / 'users.json')))
        cls.stack.enter_context(patch.dict(os.environ, MASTER_EMAIL='api-test@example.invalid', MASTER_PASSWORD='local-test'))
        import main
        cls.main = main
        cls.client = TestClient(main.app)
        token = cls.client.post('/token', data={'username': 'api-test@example.invalid', 'password': 'local-test'})
        assert token.status_code == 200, token.text
        cls.client.headers['Authorization'] = 'Bearer ' + token.json()['access_token']
        cls.vendeai = importlib.util.find_spec('auction_dispatcher') is not None

    @classmethod
    def tearDownClass(cls):
        cls.main.atypical_service._scheduler_running = False
        cls.client.close()
        cls.stack.close()
        cls.work.cleanup()

    def test_profiles_require_auth(self):
        with TestClient(self.main.app) as anonymous:
            self.assertEqual(anonymous.get('/leilao/profiles').status_code, 401)

    def test_independent_state_and_extra_odysseia_fields_survive_validation(self):
        prefix = '/esteira/control' if self.vendeai else '/leilao/state'
        content_key = 'message_template' if self.vendeai else 'note_template'
        for key, text in [('padrao', 'PADRAO {nome}'), ('odysseia', 'ODYSSEIA {banco_aprovado}')]:
            result = self.client.post(prefix + '?auction_id=' + key, json={'paused': True, content_key: text})
            self.assertEqual(result.status_code, 200, result.text)
        state = self.client.get(prefix + '?auction_id=odysseia').json()
        self.assertEqual(state[content_key], 'ODYSSEIA {banco_aprovado}')
        self.assertIn('banco_aprovado', state['available_vars'])
        self.assertEqual(self.client.get(prefix).json()[content_key], 'PADRAO {nome}')
        body = {'lead_id': 'api-odysseia', 'nome': 'Pessoa teste', 'celulares': ['31999990001'],
                'qualifica': 'true', 'valor_num': '8000.00', 'banco_aprovado': 'Banco teste',
                'validade': '2026-12-01', 'leilao_id': 'odysseia'}
        result = self.client.post('/webhook/leilao/odysseia', json=body)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['status'], 'queued')
        row = self.main.global_db.esteira_get(result.json()['id'])
        self.assertIn('Banco teste', row['payload_json'])
        duplicate = self.client.post('/webhook/leilao/odysseia', json=body)
        self.assertTrue(duplicate.json()['duplicate_lead_id'])

    def test_retry_route_only_requeues_failed_rows_of_selected_auction(self):
        row, _ = self.main.global_db.esteira_receive('+553199990002',
            {'lead_id': 'api-retry', 'leilao_id': 'padrao', 'qualifica': True}, 'failed')
        self.main.global_db.set_leilao_state(paused=True)
        route = '/esteira/retry' if self.vendeai else '/leilao/retry'
        self.assertEqual(self.client.post(route + '?auction_id=odysseia', json={'ids': [row['id']]}).json()['queued'], 0)
        result = self.client.post(route, json={'ids': [row['id']]})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['queued'], 1)
        self.assertEqual(self.client.post(route, json={'ids': []}).status_code, 400)

    def test_create_additional_auction(self):
        result = self.client.post('/leilao/profiles', json={'id': 'parceiro-api', 'name': 'Parceiro'})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIn('parceiro-api', [p['id'] for p in self.client.get('/leilao/profiles').json()])
        self.assertEqual(self.client.post('/leilao/profiles', json={'id': 'parceiro-api', 'name': 'Duplicado'}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
