import pandas as pd
import requests
import time
import threading
from itertools import cycle
from typing import Dict, Any, List
from database import Database
from datetime import datetime, timezone, timedelta

class DispatcherService:
    def __init__(self):
        self.running = False
        self.paused = False
        self.stop_event = threading.Event()
        self._thread_epoch = 0
        self.thread = None
        self.data = []
        self.status = {
            "total": 0,
            "processed": 0,
            "success": 0,
            "failed": 0,
            "skipped": 0,
            "failed_contacts": [],
            "current_action": "Inativo",
            "logs": [],
            "start_time": None,
            "started_by": None,
            "sender_stats": {},
            "completed_sheets": []
        }
        self.current_file_path = None
        self.db = Database()
        # Ensure migration happens
        self.db.import_from_json()
        self.reload_config()

    def reload_config(self):
        """Carrega configurações do banco de dados"""
        try:
            db_config = self.db.get_senders()
            # Convert to format expected by internal logic if needed, 
            # but db.get_senders() returns {"id_numeros": {...}} which matches
            self.config = db_config
        except Exception as e:
            print(f"Erro ao carregar configuração do banco: {e}")
            self.config = {"id_numeros": {}}
        
        # Initialize/Sync local stats for UI
        self.status["sender_stats"] = {}
        for sender_id, data in self.config.get("id_numeros", {}).items():
            if data.get("status") == "ativado":
                self.status["sender_stats"][sender_id] = {
                    "name": data.get("ref_numero", "Unknown"),
                    "sent_count": data.get("sent_count", 0),
                    "daily_limit": data.get("daily_limit", 0),
                    "today_count": data.get("today_count", 0)
                }

    def _add_log(self, message):
        # Agora usa o horário do sistema (configurado via Docker/TZ)
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.status["current_action"] = message
        log_obj = {"mensagem": message, "timestamp": timestamp}
        self.status["logs"].insert(0, log_obj)
        if len(self.status["logs"]) > 10: # Limit log size
            self.status["logs"].pop()
        print(f"[{timestamp}] {message}")

    def _add_structured_log(self, nome, numero, tipo, mensagem):
        # Agora usa o horário do sistema (configurado via Docker/TZ)
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.status["current_action"] = mensagem
        log_obj = {
            "nome": nome,
            "numero": numero,
            "tipo": tipo,  # e.g., "Cadastrado e Enviado", "Enviado direto", "Falha"
            "mensagem": mensagem,
            "timestamp": timestamp
        }
        self.status["logs"].insert(0, log_obj)
        if len(self.status["logs"]) > 10:
            self.status["logs"].pop()
        print(f"[{timestamp}] [{tipo}] {nome} ({numero}): {mensagem}")

    def _get_credentials(self):
        config = self.db.get_global_config()
        if not config or not config.get("account_id") or not config.get("token_key"):
            return None
            
        # Limpa espaços em branco caso copiados do painel
        config["account_id"] = config["account_id"].strip()
        config["token_key"] = config["token_key"].strip()
        return config

    def load_data(self, file_path, sheet_name=0):
        self.paused = False
        self.stop_event.clear()
        try:
            df = pd.read_excel(file_path, sheet_name=sheet_name)
            df.columns = df.columns.str.strip()  # Fix column names with trailing/leading spaces
            self.data = df.to_dict('records')
            self.status["total"] = len(self.data)
            self.status["processed"] = 0
            self.status["success"] = 0
            self.status["failed"] = 0
            self.status["skipped"] = 0
            self.status["failed_contacts"] = []
            self.status["logs"] = []
            self.status["start_time"] = None
            self.status["current_action"] = "Pronto para iniciar"
            self.status["current_sheet"] = sheet_name
            self._add_log(f"Pronto para iniciar - Aba: {sheet_name}")
        except Exception as e:
            print(f"Error loading data: {e}")
            raise

    def start(self, user_email=None):
        if not self.running:
            self.running = True
            self.stop_event.clear()
            self._thread_epoch += 1
            self.status["started_by"] = user_email
            self.thread = threading.Thread(target=self._process_loop, args=(self._thread_epoch,), daemon=True)
            self.thread.start()

    def stop(self):
        self.running = False
        self.paused = True
        self.stop_event.set()
        self._add_log("Parado pelo usuário")

    def get_status(self):
        res = self.status.copy()
        res["is_running"] = self.running and (self.thread is not None and self.thread.is_alive())
        return res

    def _process_loop(self, epoch):
        # Prepare active senders
        active_senders = []
        try:
            self.reload_config()
            for id_remetente, info in self.config["id_numeros"].items():
                if info["status"] == "ativado":
                    if info.get("daily_limit", 0) > 0 and info.get("today_count", 0) >= info.get("daily_limit", 0):
                        self._add_log(f"Remetente {info['ref_numero']} pulado: limite diário atingido hoje ({info['today_count']}/{info['daily_limit']}).")
                        continue
                    for id_dialogo in info["dialogos"]:
                        active_senders.append({
                            "id_remetente": id_remetente,
                            "ref_numero": info["ref_numero"],
                            "dialogos": id_dialogo
                        })
        except Exception as e:
            self._add_log(f"Erro ao ler configuração: {e}")

        if not active_senders:
            self._add_log("Erro: Nenhum remetente ativo configurado.")
            self.running = False
            return

        num_senders = len(active_senders)
        self._add_log(f"Iniciando processamento. Total de linhas: {len(self.data)} | Remetentes simultâneos: {num_senders}")

        self.status["start_time"] = time.time()
        
        # ── Lock para contadores thread-safe ──
        lock = threading.Lock()

        # ── Divide os dados entre os remetentes (distribuição intercalada) ──
        sender_data_slices = []
        for i in range(num_senders):
            sender_data_slices.append(self.data[i::num_senders])

        self._add_log("Disparando em paralelo...")

        # ── Worker: cada remetente processa sua fatia de contatos ──
        def worker(sender_config, rows_subset, worker_idx):
            # Escalonar o início para que não disparem ao mesmo tempo (1 disparo a cada 2.4s globalmente)
            if worker_idx > 0:
                time.sleep(worker_idx * 1.5)

            sender_id = sender_config["id_remetente"]
            dialog_id = sender_config["dialogos"]
            sender_ref = sender_config["ref_numero"]

            for row in rows_subset:
                try:
                    if not self.running or self.stop_event.is_set():
                        break

                    # Check if daily limit reached
                    if self.db.has_sender_reached_limit(sender_id):
                        self._add_log(f"Remetente {sender_ref} atingiu o limite diário de disparos. Interrompendo novos envios deste número hoje.")
                        break

                    if row.get("_processed"):
                        continue

                    numero = str(row.get('numero') or row.get('Numero') or "").strip()
                    nome_raw = row.get('nome') or row.get('Nome')
                    nome = str(nome_raw).strip() if nome_raw is not None else ""

                    if not numero:
                        with lock:
                            self.status["failed"] += 1
                            self.status["processed"] += 1
                        row["_processed"] = True
                        continue

                    # Format phone number returns a tuple (numero_12_digitos, numero_13_digitos)
                    numeros_formatados = self.formatar_numero_completo(numero)
                    if not numeros_formatados:
                        with lock:
                            self.status["failed"] += 1
                            self.status["processed"] += 1
                        self.db.log_message(numero, "unknown", "failed", name=nome, details="Erro de formatação")
                        self._add_log(f"Erro de formatação: {numero}")
                        row["_processed"] = True
                        time.sleep(0.5)
                        continue

                    numero_12_digitos, numero_13_digitos = numeros_formatados
                
                    # Nova regra da Chatguru: SP (11-19) e RJ/ES (21-29) usam os 9 dígitos integrados (13 totais). O restante remove o 9 (12 totais).
                    ddd = int(numero_12_digitos[2:4])
                    if 11 <= ddd <= 29:
                        numero_alvo = numero_13_digitos
                    else:
                        numero_alvo = numero_12_digitos

                    # Checa duplicados
                    if self.db.is_already_sent_today(numero_12_digitos) or self.db.is_already_sent_today(numero_13_digitos):
                        with lock:
                            self.status["skipped"] += 1
                            self.status["processed"] += 1
                        print(f"Pulado (já enviado hoje): {numero_12_digitos}")
                        row["_processed"] = True
                        time.sleep(0.5)
                        continue

                    self._add_log(f"Enviando para {numero_12_digitos} via {sender_ref}...")

                    # 1. Tenta enviar direto usando o número alvo da região
                    resp = self.enviar_dialogo(numero_alvo, dialog_id, sender_id)
                    if resp.get("code") == 200:
                        self.db.log_message(numero_alvo, sender_id, "success", name=nome, details="Já estava cadastrado, enviado direto.")
                        with lock:
                            self.status["success"] += 1
                            if sender_id in self.status["sender_stats"]:
                                self.status["sender_stats"][sender_id]["sent_count"] += 1
                                self.status["sender_stats"][sender_id]["today_count"] += 1
                        self._add_structured_log(nome, numero_alvo, "Enviado", f"Já estava cadastrado, enviado direto.")
                    elif resp.get("code") == 400 and "Chat não encontrado" in resp.get("description", ""):
                        self._add_log(f"Cadastrando {numero_alvo}...")
                    
                        # 1º tentativa de cadastro: numero_alvo
                        reg_resp = self.cadastrar_chat(numero_alvo, nome, sender_id)
                        chat_add_id = reg_resp.get("chat_add_id")
                        
                        # Checagem de Erro imediato (ex: Invalido no WhatsApp)
                        if not chat_add_id or reg_resp.get("code") != 201:
                            fallback_num = numero_12_digitos if numero_alvo == numero_13_digitos else numero_13_digitos
                            self._add_log(f"Cadastro falhou, tentando fallback: {fallback_num}...")
                            reg_resp = self.cadastrar_chat(fallback_num, nome, sender_id)
                            chat_add_id = reg_resp.get("chat_add_id")
                            numero_alvo_cadastro = fallback_num
                        else:
                            numero_alvo_cadastro = numero_alvo

                        if reg_resp.get("code") == 201 and chat_add_id:
                            self._add_log(f"Aguardando liberação do chat: {numero_alvo_cadastro}...")
                        
                            # Poller do status do cadastro na plataforma
                            chat_pronto = False
                            tentativas = 0
                            while tentativas < 45: # Tolerância aumentada para 90s devido a superlotação da fila na API
                                status_req = self.verificar_status_cadastro(chat_add_id, sender_id, numero_alvo_cadastro)
                                reg_status = status_req.get("chat_add_status")
                                if reg_status == "success" or reg_status == "done":
                                    chat_pronto = True
                                    time.sleep(1) # Margem de propagação
                                    break
                                elif reg_status == "error" or reg_status == "invalid":
                                    print(f"Erro no cadastro: {status_req.get('chat_add_status_description', 'Número inválido no WhatsApp')}")
                                    break
                                time.sleep(1)  # Aguarda 1 segundo antes de verificar novamente para não sobrecarregar a API
                                tentativas += 1
                            
                            if not chat_pronto:
                                 print(f"Desistimos de aguardar o cadastro {numero_alvo_cadastro}, mas vamos tentar enviar mesmo assim.")

                            # Caso tentou enviar ou aguardou o tempo todo:
                            resp_reenvio = self.enviar_dialogo(numero_alvo_cadastro, dialog_id, sender_id)
                            numero_final = numero_alvo_cadastro

                            # Fallback extra safety
                            if resp_reenvio.get("code") == 400 and "Chat não encontrado" in resp_reenvio.get("description", ""):
                                fallback_num_envio = numero_12_digitos if numero_alvo_cadastro == numero_13_digitos else numero_13_digitos
                                print(f"ChatGuru normalizou diferentemente. Fallback ({fallback_num_envio})...")
                                resp_reenvio = self.enviar_dialogo(fallback_num_envio, dialog_id, sender_id)
                                numero_final = fallback_num_envio

                            if resp_reenvio.get("code") == 200:
                                self.db.log_message(numero_final, sender_id, "success", name=nome, details="Contato novo criado e mensagem entregue.")
                                with lock:
                                    self.status["success"] += 1
                                    if sender_id in self.status["sender_stats"]:
                                        self.status["sender_stats"][sender_id]["sent_count"] += 1
                                        self.status["sender_stats"][sender_id]["today_count"] += 1
                                self._add_structured_log(nome, numero_final, "Cadastrado e Enviado", f"Contato novo criado e mensagem entregue.")
                            else:
                                err_desc = resp_reenvio.get('description', 'Erro Desconhecido')
                                self.db.log_message(numero_final, sender_id, "failed", name=nome, details=f"Pós-cadastro falhou: {err_desc}")
                                with lock:
                                    self.status["failed"] += 1
                                    self.status["failed_contacts"].append({"nome": nome, "numero": numero_final, "erro": f"Pós-cadastro falhou: {err_desc}"})
                                self._add_structured_log(nome, numero_final, "Falha Pós-Cadastro", err_desc)
                        else:
                            self.db.log_message(numero_alvo, sender_id, "failed", name=nome, details="Número é Inválido na API")
                            with lock:
                                self.status["failed"] += 1
                                self.status["failed_contacts"].append({"nome": nome, "numero": numero_alvo, "erro": reg_resp.get('description', 'Número é Inválido na API')})
                            self._add_structured_log(nome, numero_alvo, "Falha Cadastro", reg_resp.get('description', 'Erro'))
                    else:
                        self.db.log_message(numero_alvo, sender_id, "failed", name=nome, details=resp.get('description', 'Erro Desconhecido API'))
                        with lock:
                            self.status["failed"] += 1
                            self.status["failed_contacts"].append({"nome": nome, "numero": numero_alvo, "erro": resp.get('description', 'Erro Desconhecido API')})
                        self._add_structured_log(nome, numero_alvo, "Falha API", resp.get('description', 'Erro Desconhecido'))
                except Exception as e:
                    print(f"Erro critico processando linha: {e}")
                    with lock:
                        self.status["failed"] += 1
                        self.status["failed_contacts"].append({"nome": nome if 'nome' in dir() else "Desconhecido", "numero": "Erro Interno", "erro": f"Exception: {str(e)}"})
                    self._add_structured_log(nome if 'nome' in dir() else "Desconhecido", "Erro", "Exceção Interna", str(e))

                row["_processed"] = True
                with lock:
                    self.status["processed"] += 1
                time.sleep(1 * num_senders)  # Mantém a média global de 1 disparo a cada 1s para aprox 1000 disparos em 30 minutos

        # ── Lança uma thread por remetente ──
        threads = []
        for i, sender in enumerate(active_senders):
            t = threading.Thread(target=worker, args=(sender, sender_data_slices[i], i), name=f"worker-{sender['ref_numero']}")
            threads.append(t)
            t.start()

        # ── Aguarda todas as threads terminarem ──
        for t in threads:
            t.join()

        if self._thread_epoch == epoch:
            self.running = False
        
        if self.paused:
            self.status["current_action"] = "Parado pelo usuário"
            self._add_log("Disparo pausado.")
            print("=== Disparo pausado ===")
        else:
            self.status["current_action"] = "Concluído"
            
            # Add to completed_sheets list
            current_sheet = self.status.get("current_sheet")
            if current_sheet and current_sheet not in self.status["completed_sheets"]:
                self.status["completed_sheets"].append(current_sheet)

            self._add_log("Disparo finalizado.")
            self._add_log("Concluído")
            print("=== Disparo finalizado. ===")

    def _send_with_retry(self, numero, nome, dialog_id, phone_id):
        # Kept for compatibility; main logic now in _process_loop two phases
        resp = self.enviar_dialogo(numero, dialog_id, phone_id)
        if resp.get("code") == 200:
            return True
        return False


    def formatar_numero_completo(self, telefone):
        # Always return a tuple of two strings (numero_12_digitos, numero_13_digitos)
        # numero_12_digitos: 55 + 2 DDD + 8 digitos (ex: 553199999999) - Ideal para dialog_execute
        # numero_13_digitos: 55 + 2 DDD + 9 digitos (ex: 5531999999999) - Ideal para chat_add
        # Se vier como float do Excel (ex: 83986556027.0), converte pra int primeiro
        try:
            telefone = int(float(telefone))
        except (ValueError, TypeError):
            pass
        telefone_str = "".join([c for c in str(telefone) if c.isdigit()])
        if telefone_str.startswith("55") and len(telefone_str) > 11:
            telefone_str = telefone_str[2:]
            
        if len(telefone_str) < 10:
            return False # Sem DDD

        if len(telefone_str) == 11:
            # Já possui 9 digitos (ex: 31988887777)
            ddd = telefone_str[:2]
            numero_9 = telefone_str[2:] # 988887777
            numero_8 = telefone_str[3:] # 88887777
            return ("55" + ddd + numero_8, "55" + ddd + numero_9)

        if len(telefone_str) == 10:
            # Possui 8 digitos (ex: 3188887777)
            ddd = telefone_str[:2]
            numero_8 = telefone_str[2:]
            numero_9 = "9" + numero_8
            return ("55" + ddd + numero_8, "55" + ddd + numero_9)

        return False

    def _make_request(self, endpoint_url, parametros, max_retries=3):
        import requests
        import time
        
        delay = 2
        for attempt in range(max_retries):
            try:
                res = requests.post(endpoint_url, data=parametros, timeout=15)
                # Se for bloqueio de limite (429 Too Many Requests), faz o backoff
                if res.status_code == 429:
                    print(f"Rate limit API ChatGuru (429). Aguardando {delay}s na tentativa {attempt+1}...")
                    time.sleep(delay)
                    delay *= 2
                    continue
                    
                return dict(res.json())
            except requests.exceptions.RequestException as e:
                print(f"Falha de conexão com a API (Tentativa {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(delay)
                    delay *= 2
                else:
                    print("Esgotadas as tentativas de requisição.")
                    return {}
        return {}

    def cadastrar_chat(self, numero_formatado, nome, phone_id, dialog_id=None):
        cred = self._get_credentials()
        if not cred: return {}
        
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
        if dialog_id:
            parametros["dialog_id"] = dialog_id
            
        endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
        return self._make_request(endpoint_url, parametros)

    def verificar_status_cadastro(self, chat_add_id, phone_id, chat_number):
        """Verifica o status do cadastro assíncrono via chat_add_status"""
        cred = self._get_credentials()
        if not cred: return {}
        
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

    def enviar_dialogo(self, numero_formatado, dialogo, phone_id):
        cred = self._get_credentials()
        if not cred: return {}
        
        parametros = {
            "key": cred["token_key"],
            "account_id": cred["account_id"],
            "phone_id": phone_id,
            "action": "dialog_execute",
            "chat_number": numero_formatado,
            "dialog_id": dialogo
        }
        endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
        return self._make_request(endpoint_url, parametros)
