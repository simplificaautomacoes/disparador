"""
Atypical Dispatcher Service — Serviço independente para disparos atípicos.

Funciona de forma totalmente separada do DispatcherService principal,
com suporte a multi-tarefa paralela e agendamento de disparos.
"""

import pandas as pd
import requests
import time
import math
import threading
import re
from datetime import datetime, timezone, timedelta
from database import Database


# Fuso horário de Brasília (UTC-3)
BRT = timezone(timedelta(hours=-3))


class AtypicalService:
    def __init__(self):
        self.db = Database()
        self.active_tasks = {}  # task_id -> thread
        self.task_cancellation = {}  # task_id -> Event (para cancelar)
        self._scheduler_thread = None
        self._scheduler_running = False
        self._start_scheduler()

    def _start_scheduler(self):
        """Inicia thread que verifica tarefas agendadas a cada 30s"""
        if self._scheduler_running:
            return
        self._scheduler_running = True
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._scheduler_thread.start()

    def _scheduler_loop(self):
        while self._scheduler_running:
            try:
                pending_tasks = self.db.get_pending_atypical_tasks()
                for task in pending_tasks:
                    task_id = task["id"]
                    if task_id not in self.active_tasks:
                        self._launch_task(task_id)
            except Exception as e:
                print(f"[Scheduler Atípico] Erro: {e}")
            time.sleep(30)

    def _get_credentials(self):
        config = self.db.get_global_config()
        if not config or not config.get("account_id") or not config.get("token_key"):
            return None
        config["account_id"] = config["account_id"].strip()
        config["token_key"] = config["token_key"].strip()
        return config

    def _make_request(self, endpoint_url, parametros, max_retries=3):
        delay = 2
        for attempt in range(max_retries):
            try:
                res = requests.post(endpoint_url, data=parametros, timeout=15)
                if res.status_code == 429:
                    print(f"[Atípico] Rate limit (429). Aguardando {delay}s...")
                    time.sleep(delay)
                    delay *= 2
                    continue
                return dict(res.json())
            except requests.exceptions.RequestException as e:
                print(f"[Atípico] Falha de conexão (Tentativa {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(delay)
                    delay *= 2
                else:
                    return {"error": str(e)}
        return {}

    def formatar_numero_completo(self, telefone):
        try:
            telefone = int(float(telefone))
        except (ValueError, TypeError):
            pass
        telefone_str = "".join([c for c in str(telefone) if c.isdigit()])
        if telefone_str.startswith("55") and len(telefone_str) > 11:
            telefone_str = telefone_str[2:]
        if len(telefone_str) < 10:
            return False
        if len(telefone_str) == 11:
            ddd = telefone_str[:2]
            numero_9 = telefone_str[2:]
            numero_8 = telefone_str[3:]
            return ("55" + ddd + numero_8, "55" + ddd + numero_9)
        if len(telefone_str) == 10:
            ddd = telefone_str[:2]
            numero_8 = telefone_str[2:]
            numero_9 = "9" + numero_8
            return ("55" + ddd + numero_8, "55" + ddd + numero_9)
        return False

    def enviar_dialogo(self, numero_formatado, dialog_id, phone_id):
        cred = self._get_credentials()
        if not cred:
            return {}
        parametros = {
            "key": cred["token_key"],
            "account_id": cred["account_id"],
            "phone_id": phone_id,
            "action": "dialog_execute",
            "chat_number": numero_formatado,
            "dialog_id": dialog_id
        }
        endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
        return self._make_request(endpoint_url, parametros)

    def cadastrar_chat(self, numero_formatado, nome, phone_id):
        cred = self._get_credentials()
        if not cred:
            return {}
        nome_str = str(nome).strip()
        nome_safe = nome_str if nome_str and nome_str.lower() != 'nan' else f"Novo Contato {numero_formatado}"
        parametros = {
            "key": cred["token_key"],
            "account_id": cred["account_id"],
            "phone_id": phone_id,
            "action": "chat_add",
            "name": nome_safe,
            "chat_number": numero_formatado,
            "text": " "
        }
        endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
        return self._make_request(endpoint_url, parametros)

    def verificar_status_cadastro(self, chat_add_id, phone_id, chat_number):
        cred = self._get_credentials()
        if not cred:
            return {}
        parametros = {
            "key": cred["token_key"],
            "account_id": cred["account_id"],
            "phone_id": phone_id,
            "action": "chat_add_status",
            "chat_add_id": chat_add_id,
            "chat_number": chat_number
        }
        endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
        return self._make_request(endpoint_url, parametros)

    def adicionar_anotacao(self, numero, note_text, phone_id):
        cred = self._get_credentials()
        if not cred:
            return {}
        parametros = {
            "key": cred["token_key"],
            "account_id": cred["account_id"],
            "phone_id": phone_id,
            "action": "note_add",
            "chat_number": numero,
            "note_text": note_text
        }
        endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
        return self._make_request(endpoint_url, parametros)

    def _limpa_valor_monetario(self, valor):
        try:
            if isinstance(valor, str):
                if ',' in valor and '.' not in valor:
                    return float(valor.replace(',', '.'))
                elif ',' in valor and '.' in valor:
                    return float(valor.replace('.', '').replace(',', '.'))
                return float(valor)
            return float(valor)
        except:
            return 0.0

    def _format_brl(self, value):
        """Formata valor para BRL: R$ 1.234,56"""
        v = self._limpa_valor_monetario(value)
        return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    def _build_note_text(self, template, row, column_mapping):
        """
        Substitui placeholders no template com valores da planilha.
        column_mapping: {"placeholder_name": {"column": "col_name", "format": "text|money"}}
        """
        text = template
        for placeholder, mapping in column_mapping.items():
            col_name = mapping.get("column", "")
            fmt = mapping.get("format", "text")
            raw_value = row.get(col_name, "")

            if pd.isna(raw_value):
                raw_value = ""

            if fmt == "money":
                display_value = self._format_brl(raw_value)
            else:
                display_value = str(raw_value).strip()

            text = text.replace(f"{{{placeholder}}}", display_value)
        return text

    def start_task(self, task_id):
        """Inicia uma tarefa imediatamente"""
        if task_id in self.active_tasks and self.active_tasks[task_id].is_alive():
            return False
        self._launch_task(task_id)
        return True

    def cancel_task(self, task_id):
        """Cancela uma tarefa"""
        if task_id in self.task_cancellation:
            self.task_cancellation[task_id].set()
        self.db.update_atypical_task_status(
            task_id, "cancelled",
            completed_at=datetime.now(BRT).isoformat()
        )
        return True

    def _launch_task(self, task_id):
        """Lança a thread que processa a tarefa"""
        cancel_event = threading.Event()
        self.task_cancellation[task_id] = cancel_event
        t = threading.Thread(target=self._execute_task, args=(task_id, cancel_event), daemon=True)
        self.active_tasks[task_id] = t
        t.start()

    def _execute_task(self, task_id, cancel_event):
        """Lógica principal de execução de uma tarefa atípica"""
        task = self.db.get_atypical_task(task_id)
        if not task:
            return

        # Marca como running
        self.db.update_atypical_task_status(
            task_id, "running",
            started_at=datetime.now(BRT).isoformat()
        )

        # Carrega planilha
        try:
            df = pd.read_excel(task["file_path"])
            df.columns = df.columns.str.strip()
        except Exception as e:
            self.db.update_atypical_task_status(
                task_id, "failed",
                completed_at=datetime.now(BRT).isoformat()
            )
            return

        # Carrega remetentes ativos com templates atípicos
        active_senders = self.db.get_active_atypical_senders()
        if not active_senders:
            self.db.update_atypical_task_status(
                task_id, "failed",
                completed_at=datetime.now(BRT).isoformat()
            )
            return

        num_senders = len(active_senders)
        total = len(df)
        phone_col = task["phone_column"]
        phone_col_fb = task.get("phone_column_fallback")
        name_col = task["name_column"]
        note_template = task["note_template"]
        column_mapping = task["column_mapping"]

        # Contadores thread-safe
        lock = threading.Lock()
        counters = {"processed": 0, "success": 0, "failed": 0, "skipped": 0}
        logs = []

        def add_log(msg, tipo="info"):
            ts = datetime.now(BRT).strftime("%H:%M:%S")
            entry = {"mensagem": msg, "tipo": tipo, "timestamp": ts}
            with lock:
                logs.insert(0, entry)
                if len(logs) > 15:
                    logs.pop()

        # Divide dados entre remetentes
        data_records = df.to_dict('records')
        slices = [data_records[i::num_senders] for i in range(num_senders)]

        add_log(f"Iniciando disparo atípico: {total} contatos, {num_senders} remetentes")

        def worker(sender, rows_subset, worker_idx):
            if worker_idx > 0:
                time.sleep(worker_idx * 1.5)

            sender_id = sender["sender_id"]
            dialog_id = sender["dialog_id"]
            sender_ref = sender["ref_numero"]

            for row in rows_subset:
                if cancel_event.is_set():
                    break

                # Pegar telefone
                phone_raw = row.get(phone_col)
                numero_alvo = None

                if pd.notna(phone_raw) and str(phone_raw).strip():
                    try:
                        numero_alvo = int(float(phone_raw))
                    except:
                        numero_alvo = None

                # Fallback
                if not numero_alvo and phone_col_fb:
                    phone_fb = row.get(phone_col_fb)
                    if pd.notna(phone_fb) and str(phone_fb).strip():
                        try:
                            numero_alvo = int(float(phone_fb))
                        except:
                            pass

                if not numero_alvo:
                    with lock:
                        counters["skipped"] += 1
                        counters["processed"] += 1
                    continue

                nome = str(row.get(name_col, "")).strip()
                if not nome or nome.lower() == "nan":
                    nome = ""

                formatado = self.formatar_numero_completo(numero_alvo)
                if not formatado:
                    with lock:
                        counters["failed"] += 1
                        counters["processed"] += 1
                    add_log(f"Número inválido: {numero_alvo}", "falha")
                    continue

                num_12, num_13 = formatado
                ddd = int(num_12[2:4])
                numero_final = num_13 if 11 <= ddd <= 29 else num_12

                # 1. Enviar diálogo
                resp = self.enviar_dialogo(numero_final, dialog_id, sender_id)
                sucesso_envio = False

                if resp.get("code") == 200:
                    sucesso_envio = True
                    add_log(f"Enviado direto: {nome or numero_final} via {sender_ref}", "enviado")
                elif resp.get("code") == 400 and "Chat não encontrado" in resp.get("description", ""):
                    # Cadastrar
                    reg_resp = self.cadastrar_chat(numero_final, nome, sender_id)
                    chat_add_id = reg_resp.get("chat_add_id")

                    if not chat_add_id or reg_resp.get("code") != 201:
                        fallback_num = num_12 if numero_final == num_13 else num_13
                        reg_resp = self.cadastrar_chat(fallback_num, nome, sender_id)
                        chat_add_id = reg_resp.get("chat_add_id")
                        numero_final = fallback_num

                    if reg_resp.get("code") == 201 and chat_add_id:
                        chat_pronto = False
                        for _ in range(45):
                            if cancel_event.is_set():
                                break
                            time.sleep(1)
                            status_req = self.verificar_status_cadastro(chat_add_id, sender_id, numero_final)
                            reg_status = status_req.get("chat_add_status")
                            if reg_status in ["success", "done"]:
                                chat_pronto = True
                                break
                            elif reg_status in ["error", "invalid"]:
                                break

                        resp_reenvio = self.enviar_dialogo(numero_final, dialog_id, sender_id)

                        if resp_reenvio.get("code") == 400 and "Chat não encontrado" in resp_reenvio.get("description", ""):
                            fallback_envio = num_12 if numero_final == num_13 else num_13
                            resp_reenvio = self.enviar_dialogo(fallback_envio, dialog_id, sender_id)
                            numero_final = fallback_envio

                        if resp_reenvio.get("code") == 200:
                            sucesso_envio = True
                            add_log(f"Cadastrado e enviado: {nome or numero_final} via {sender_ref}", "cadastrado")
                        else:
                            add_log(f"Falha pós-cadastro: {nome or numero_final}", "falha")
                    else:
                        add_log(f"Cadastro falhou: {nome or numero_final}", "falha")
                else:
                    add_log(f"Erro API: {nome or numero_final} - {resp.get('description', 'Erro')}", "falha")

                # 2. Enviar anotação se sucesso e template não vazio
                if sucesso_envio and note_template and note_template.strip():
                    note_text = self._build_note_text(note_template, row, column_mapping)
                    resp_note = self.adicionar_anotacao(numero_final, note_text, sender_id)
                    if resp_note.get("code") not in [200, 201]:
                        # Fallback anotação
                        fallback_note = num_12 if numero_final == num_13 else num_13
                        self.adicionar_anotacao(fallback_note, note_text, sender_id)

                if sucesso_envio:
                    with lock:
                        counters["success"] += 1
                else:
                    with lock:
                        counters["failed"] += 1

                with lock:
                    counters["processed"] += 1
                    # Persist progress every 5 records
                    if counters["processed"] % 5 == 0 or counters["processed"] == total:
                        self.db.update_atypical_task_progress(
                            task_id,
                            counters["processed"], counters["success"],
                            counters["failed"], counters["skipped"],
                            logs
                        )

                time.sleep(1 * num_senders)

        # Launch workers
        threads = []
        for i, sender in enumerate(active_senders):
            if i < len(slices) and len(slices[i]) > 0:
                t = threading.Thread(target=worker, args=(sender, slices[i], i), daemon=True)
                threads.append(t)
                t.start()

        # Wait for all
        for t in threads:
            t.join()

        # Final update
        final_status = "cancelled" if cancel_event.is_set() else "done"
        self.db.update_atypical_task_progress(
            task_id,
            counters["processed"], counters["success"],
            counters["failed"], counters["skipped"],
            logs
        )
        self.db.update_atypical_task_status(
            task_id, final_status,
            completed_at=datetime.now(BRT).isoformat()
        )

        # Cleanup
        self.active_tasks.pop(task_id, None)
        self.task_cancellation.pop(task_id, None)

        add_log(f"Tarefa finalizada: {counters['success']} enviados, {counters['failed']} falhas", "concluido")
