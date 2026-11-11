import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

import requests
import database
import leilao_service
from chatguru import _make_request
from database import Database
from leilao_service import LeilaoService
from rate_limit import SenderRateLimiter


class LeilaoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(database.DATA_DIR).resolve())
        self.addCleanup(self.cleanup_temp)
        self.db_file = patch.object(database, 'DB_FILE', str(Path(self.temp.name) / 'test.db'))
        self.db_file.start()
        self.addCleanup(self.db_file.stop)
        self.db = Database()
        self.db.set_global_config('account', 'token', 'Teste', '')
        self.db.add_sender('sender', 'FB1807')
        self.db.add_leilao_dialog('sender', 'dialog')
        self.db.set_leilao_state(interval_seconds=0)
        self.svc = LeilaoService(self.db)
        self.limiter = SenderRateLimiter(self.db)
        for name, value in [('get_limiter', lambda db: self.limiter),
                            ('enviar_dialogo', Mock(return_value={'code': 200})),
                            ('adicionar_anotacao', Mock(return_value={'code': 200})), ('time.sleep', Mock())]:
            p = patch('leilao_service.' + name, value)
            p.start()
            self.addCleanup(p.stop)
        self.lead = {'lead_id': 'lead-1', 'nome': 'Teste', 'celulares': '31999990001', 'qualifica': True, 'leilao_id': 'padrao'}

    def cleanup_temp(self):
        # O SQLite/Windows pode liberar os arquivos WAL alguns milissegundos depois.
        for attempt in range(10):
            try:
                self.temp.cleanup()
                return
            except OSError:
                if attempt == 9:
                    raise
                threading.Event().wait(0.05)

    def test_odysseia_settings_queue_and_note_are_independent(self):
        self.svc.profiles.update('padrao', paused=True, note_template='PADRAO {nome}')
        self.svc.profiles.update('odysseia', paused=False, interval_seconds=0,
                                 note_template='ODYSSEIA {banco_aprovado} {valor_liberado}')
        queued = self.svc.receive_lead(self.lead)
        odysseia = dict(self.lead, leilao_id='odysseia', celulares='31999990002', banco_aprovado='Banco Teste', valor_liberado=5000)
        sent = self.svc.receive_lead(odysseia)
        self.assertEqual(queued['status'], 'queued')
        self.assertEqual(sent['status'], 'sent')
        self.assertNotEqual(queued['id'], sent['id'])
        self.assertEqual(len(self.db.get_leilao_log(auction_id='odysseia')), 1)
        self.assertEqual(leilao_service.adicionar_anotacao.call_args.args[2], 'ODYSSEIA Banco Teste 5000')
        self.svc.drain_queued()
        self.assertEqual(self.db.esteira_get(queued['id'])['status'], 'queued')

    def test_new_auction_preserves_default_settings(self):
        self.svc.profiles.update('padrao', note_template='Original', interval_seconds=3)
        self.svc.profiles.create('parceiro', 'Outro leilão')
        self.svc.profiles.update('parceiro', note_template='{nome}', interval_seconds=8)
        self.assertEqual(self.svc.profiles.state('padrao')['note_template'], 'Original')
        self.assertEqual(self.svc.profiles.state('padrao')['interval_seconds'], 3)
        self.assertEqual(self.svc.profiles.state('parceiro')['interval_seconds'], 8)

    def test_repeated_webhook_sends_once(self):
        first = self.svc.receive_lead(self.lead)
        second = self.svc.receive_lead(self.lead)
        self.assertEqual(first['status'], 'sent')
        self.assertTrue(second['duplicate_lead_id'])
        self.assertEqual(first['id'], second['id'])
        leilao_service.enviar_dialogo.assert_called_once()
        self.assertEqual(len(self.db.get_leilao_log()), 1)

    def test_simultaneous_webhooks_reserve_one_lead(self):
        barrier = threading.Barrier(8)
        def receive(_):
            barrier.wait()
            return LeilaoService(Database()).receive_lead(self.lead)
        with ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(receive, range(8)))
        self.assertEqual(len({r['id'] for r in rows}), 1)
        leilao_service.enviar_dialogo.assert_called_once()

    def test_resume_updates_original_queue_without_new_rows(self):
        self.db.set_leilao_state(paused=True)
        row = self.svc.receive_lead(self.lead)
        self.assertEqual(row['status'], 'queued')
        self.db.set_leilao_state(paused=False)
        self.svc.drain_queued()
        self.svc.drain_queued()
        self.assertEqual(self.db.esteira_get(row['id'])['status'], 'sent')
        self.assertEqual(len(self.db.get_leilao_log()), 1)
        leilao_service.enviar_dialogo.assert_called_once()

    def test_registration_does_not_execute_dialog_twice(self):
        leilao_service.enviar_dialogo.side_effect = [
            {'code': 400, 'description': 'Chat não encontrado.'}, {'code': 200}]
        with patch('leilao_service.cadastrar_chat', return_value={'code': 201, 'chat_add_id': 'add'}) as register, \
             patch('leilao_service.verificar_status_cadastro', return_value={'chat_add_status': 'done'}):
            self.assertEqual(self.svc.receive_lead(self.lead)['status'], 'sent')
        self.assertNotIn('dialog_id', register.call_args.kwargs)
        self.assertEqual(len(register.call_args.args), 4)
        self.assertEqual(leilao_service.enviar_dialogo.call_count, 2)  # rejeição + uma execução

    def test_registration_failure_does_not_execute_again(self):
        leilao_service.enviar_dialogo.return_value = {'code': 400, 'description': 'Chat não encontrado.'}
        with patch('leilao_service.cadastrar_chat', return_value={'code': 400, 'description': 'Inválido'}):
            self.assertEqual(self.svc.receive_lead(self.lead)['status'], 'failed')
        leilao_service.enviar_dialogo.assert_called_once()

    def test_annotation_is_written_before_dialog_starts(self):
        order = []
        self.svc.profiles.update('padrao', note_template='Cliente {nome}')
        leilao_service.adicionar_anotacao.side_effect = lambda *args: (order.append('note') or {'code': 200})
        leilao_service.enviar_dialogo.side_effect = lambda *args: (order.append('dialog') or {'code': 200})
        self.assertEqual(self.svc.receive_lead(self.lead)['status'], 'sent')
        self.assertEqual(order, ['note', 'dialog'])

    def test_failed_annotation_does_not_start_dialog_without_client_data(self):
        self.svc.profiles.update('padrao', note_template='Cliente {nome}')
        leilao_service.adicionar_anotacao.return_value = {'code': 400, 'description': 'Nota recusada'}
        self.assertEqual(self.svc.receive_lead(self.lead)['status'], 'failed')
        leilao_service.enviar_dialogo.assert_not_called()

    def test_retry_failed_preserves_id_and_payload(self):
        leilao_service.enviar_dialogo.return_value = {'code': 400, 'description': 'Falha temporária'}
        row = self.svc.receive_lead(self.lead)
        self.assertEqual(row['status'], 'failed')
        self.db.set_leilao_state(paused=True)
        self.assertEqual(self.svc.retry_failed([row['id'], row['id']])['queued'], 1)
        self.assertEqual(self.svc.retry_failed([row['id']])['queued'], 0)
        leilao_service.enviar_dialogo.return_value = {'code': 200}
        self.db.set_leilao_state(paused=False)
        self.svc.drain_queued()
        stored = self.db.esteira_get(row['id'])
        self.assertEqual(stored['status'], 'sent')
        self.assertEqual(json.loads(stored['payload_json'])['lead'], self.lead)
        self.assertEqual(len(self.db.get_leilao_log()), 1)
        self.assertEqual(self.svc.retry_failed([row['id']])['queued'], 0)

    def test_same_phone_different_lead_is_not_resent(self):
        self.svc.receive_lead(self.lead)
        row = self.svc.receive_lead(dict(self.lead, lead_id='lead-2', celulares='5531999990001'))
        self.assertEqual(row['status'], 'skipped')
        leilao_service.enviar_dialogo.assert_called_once()

    def test_phone_claim_blocks_other_database_instances(self):
        first, _ = self.db.esteira_receive('+553199990001', self.lead, 'queued')
        second, _ = self.db.esteira_receive('+553199990001', dict(self.lead, lead_id='other'), 'queued')
        self.assertTrue(self.db.esteira_claim(first['id'], '553199990001'))
        self.assertFalse(Database().esteira_claim(second['id'], '553199990001'))
        self.assertEqual(self.db.esteira_get(second['id'])['status'], 'queued')

    def test_unknown_delivery_is_not_retried_and_keeps_phone_claim(self):
        leilao_service.enviar_dialogo.return_value = {'code': 599, 'outcome_unknown': True}
        row = self.svc.receive_lead(self.lead)
        self.assertEqual(row['status'], 'unknown')
        self.assertEqual(self.svc.retry_failed([row['id']])['queued'], 0)
        other = self.svc.receive_lead(dict(self.lead, lead_id='other'))
        self.assertTrue(other['busy'])
        leilao_service.enviar_dialogo.assert_called_once()

    def test_unknown_requires_explicit_confirmation_before_retry(self):
        leilao_service.enviar_dialogo.return_value = {'code': 599, 'outcome_unknown': True}
        row = self.svc.receive_lead(self.lead)
        self.db.set_leilao_state(paused=True)
        self.assertEqual(self.svc.retry_failed([row['id']])['queued'], 0)
        self.assertEqual(self.svc.retry_failed([row['id']], confirmed_not_sent=True)['queued'], 1)
        leilao_service.enviar_dialogo.return_value = {'code': 200}
        self.db.set_leilao_state(paused=False)
        self.svc.drain_queued()
        self.assertEqual(self.db.esteira_get(row['id'])['status'], 'sent')

    def test_exhausted_sender_is_skipped_for_available_sender(self):
        self.db.update_sender_daily_limit('sender', 1)
        self.limiter.configure('sender', daily_limit=1)
        self.limiter.record('sender', ok=True)
        self.db.add_sender('other', 'Outro número')
        self.db.add_leilao_dialog('other', 'other-dialog')
        row = self.svc.receive_lead(self.lead)
        self.assertEqual(row['status'], 'sent')
        self.assertEqual(row['sender_id'], 'other')

    def test_legacy_queue_payload_is_supported(self):
        row_id = self.db.esteira_log('+553199990001', payload_json=json.dumps(self.lead))
        self.svc.drain_queued()
        self.assertEqual(self.db.esteira_get(row_id)['status'], 'sent')

    def test_missing_credentials_can_be_reprocessed(self):
        self.db.set_global_config('', '', 'Teste', '')
        row = self.svc.receive_lead(self.lead)
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(len(self.db.get_leilao_log()), 1)
        self.assertTrue(self.db.esteira_claim(self.db.esteira_receive(
            '+553199990001', dict(self.lead, lead_id='other'), 'queued')[0]['id'], '553199990001'))


class ChatGuruRequestTests(unittest.TestCase):
    def test_fb1807_identifier_is_trimmed_at_api_boundary(self):
        response = Mock(status_code=200)
        response.json.return_value = {'code': 200}
        params = {'action': 'dialog_execute', 'phone_id': '\t6ae4e44b94b8887355dffb61', 'dialog_id': ' id '}
        with patch('chatguru.requests.post', return_value=response) as post:
            self.assertEqual(_make_request('https://test.invalid', params)['code'], 200)
        sent = post.call_args.kwargs['data']
        self.assertEqual(sent['phone_id'], '6ae4e44b94b8887355dffb61')
        self.assertEqual(sent['dialog_id'], 'id')
        self.assertTrue(params['phone_id'].startswith('\t'))

    def test_timeout_on_send_does_not_automatically_repeat(self):
        with patch('chatguru.requests.post', side_effect=requests.exceptions.ReadTimeout) as post:
            result = _make_request('https://test.invalid', {'action': 'dialog_execute'})
        self.assertTrue(result['outcome_unknown'])
        post.assert_called_once()

    def test_corrupted_accent_still_recognizes_missing_chat(self):
        response = Mock(status_code=200)
        response.json.return_value = {'code': 400, 'description': 'Chat n\ufffdo encontrado.'}
        with patch('chatguru.requests.post', return_value=response):
            result = _make_request('https://test.invalid', {'action': 'dialog_execute'})
        self.assertEqual(result['description'], 'Chat não encontrado.')


if __name__ == '__main__':
    unittest.main()
