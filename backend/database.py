import sqlite3
import json
import os
from datetime import datetime, timedelta, timezone
import threading

BRT = timezone(timedelta(hours=-3))

DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)
DB_FILE = os.path.join(DATA_DIR, "app.db")

class Database:
    def __init__(self):
        self.lock = threading.Lock()
        self._init_db()

    def _get_conn(self):
        conn = sqlite3.connect(DB_FILE, check_same_thread=False, timeout=15.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            
            # Tabela de Remetentes
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS senders (
                    id TEXT PRIMARY KEY,
                    ref_numero TEXT,
                    status TEXT,
                    created_at TEXT,
                    legacy_success_count INTEGER DEFAULT 0
                )
            ''')
            
            # Check if column exists (for migration of existing DB)
            try:
                cursor.execute("SELECT legacy_success_count FROM senders LIMIT 1")
            except sqlite3.OperationalError:
                cursor.execute("ALTER TABLE senders ADD COLUMN legacy_success_count INTEGER DEFAULT 0")
            
            # Check if daily_limit column exists
            try:
                cursor.execute("SELECT daily_limit FROM senders LIMIT 1")
            except sqlite3.OperationalError:
                cursor.execute("ALTER TABLE senders ADD COLUMN daily_limit INTEGER DEFAULT 0")

            # Limitadores de envio por número (3 janelas) — portados do app VendeAI
            for _col, _ddl in (
                ("hourly_limit", "INTEGER DEFAULT 0"),
                ("per_second_limit", "REAL DEFAULT 0"),
                ("meta_daily_cap", "INTEGER DEFAULT 0"),
                ("auto_pause_failures", "INTEGER DEFAULT 5"),
            ):
                try:
                    cursor.execute(f"SELECT {_col} FROM senders LIMIT 1")
                except sqlite3.OperationalError:
                    cursor.execute(f"ALTER TABLE senders ADD COLUMN {_col} {_ddl}")

            # Diálogos do leilão por remetente (sender_id, dialog_id; sem limite de quantos)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS leilao_dialogs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender_id TEXT NOT NULL,
                    dialog_id TEXT NOT NULL,
                    created_at TEXT,
                    UNIQUE(sender_id, dialog_id),
                    FOREIGN KEY(sender_id) REFERENCES senders(id)
                )
            ''')

            # Estado do leilão (pausado, intervalo, template de anotação)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS leilao_state (
                    id INTEGER PRIMARY KEY DEFAULT 1,
                    paused INTEGER DEFAULT 0,
                    interval_seconds REAL DEFAULT 1.0,
                    note_template TEXT DEFAULT ''
                )
            ''')
            cursor.execute("INSERT OR IGNORE INTO leilao_state (id) VALUES (1)")

            # Log de leads do leilão
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS lead_esteira_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    phone TEXT,
                    name TEXT,
                    cpf TEXT,
                    email TEXT,
                    birth_date TEXT,
                    product TEXT,
                    campaign TEXT,
                    sender_id TEXT,
                    dialog_id TEXT,
                    status TEXT DEFAULT 'queued',
                    details TEXT,
                    payload_json TEXT,
                    source TEXT DEFAULT 'webhook',
                    created_at TEXT,
                    sent_at TEXT,
                    lead_id TEXT
                )
            ''')

            # Config de anotação do disparo principal por planilha
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS dispatch_sheet_config (
                    sheet_name TEXT PRIMARY KEY,
                    note_template TEXT,
                    column_mapping TEXT,
                    interval_seconds REAL DEFAULT 1.0,
                    updated_at TEXT
                )
            ''')
            
            # Tabela de Dialogos dos Remetentes
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sender_dialogs (
                    sender_id TEXT,
                    dialog_id TEXT,
                    FOREIGN KEY(sender_id) REFERENCES senders(id)
                )
            ''')
            
            # Tabela de Log de Mensagens (Histórico)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS message_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT,
                    phone TEXT,
                    name TEXT,
                    sender_id TEXT,
                    status TEXT,
                    details TEXT,
                    timestamp TEXT
                )
            ''')
            
            # Migration for name and details columns
            try:
                cursor.execute("SELECT name FROM message_log LIMIT 1")
            except sqlite3.OperationalError:
                cursor.execute("ALTER TABLE message_log ADD COLUMN name TEXT")
                
            try:
                cursor.execute("SELECT details FROM message_log LIMIT 1")
            except sqlite3.OperationalError:
                cursor.execute("ALTER TABLE message_log ADD COLUMN details TEXT")
            
            # Tabela de Estatísticas Diárias (agregado) - Opcional, mas vamos calcular on-the-fly por enquanto ou cachear se precisar
            
            # Tabela de Configurações Globais (Multi-tenant)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS global_config (
                    id INTEGER PRIMARY KEY DEFAULT 1,
                    account_id TEXT,
                    token_key TEXT,
                    company_name TEXT,
                    logo_path TEXT,
                    endpoint_url TEXT
                )
            ''')
            
            try:
                cursor.execute("SELECT endpoint_url FROM global_config LIMIT 1")
            except sqlite3.OperationalError:
                cursor.execute("ALTER TABLE global_config ADD COLUMN endpoint_url TEXT DEFAULT 'https://s17.chatguru.app/api/v1'")

            # Dedup configurável (dias). Padrão 7 para preservar o comportamento antigo.
            try:
                cursor.execute("SELECT dedup_days FROM global_config LIMIT 1")
            except sqlite3.OperationalError:
                cursor.execute("ALTER TABLE global_config ADD COLUMN dedup_days INTEGER DEFAULT 7")
            
            # Tabela de Templates Atípicos (diálogo por remetente para o atípico)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS atypical_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender_id TEXT NOT NULL,
                    dialog_id TEXT NOT NULL,
                    label TEXT DEFAULT '',
                    status TEXT DEFAULT 'ativado',
                    created_at TEXT,
                    FOREIGN KEY(sender_id) REFERENCES senders(id)
                )
            ''')

            # Tabela de Tarefas Atípicas (disparos agendados ou em execução)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS atypical_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    status TEXT DEFAULT 'pending',
                    scheduled_at TEXT,
                    started_at TEXT,
                    completed_at TEXT,
                    file_path TEXT,
                    phone_column TEXT,
                    phone_column_fallback TEXT,
                    name_column TEXT,
                    note_template TEXT,
                    column_mapping TEXT,
                    total INTEGER DEFAULT 0,
                    processed INTEGER DEFAULT 0,
                    success INTEGER DEFAULT 0,
                    failed INTEGER DEFAULT 0,
                    skipped INTEGER DEFAULT 0,
                    logs TEXT DEFAULT '[]',
                    created_at TEXT,
                    created_by TEXT
                )
            ''')

            conn.commit()
            conn.close()

    def import_from_json(self):
        """Importa dados do antigo JSON se o banco estiver vazio ou atualiza legado"""
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            
            # Se arquivo existe
            if os.path.exists("dic_numeros.json"):
                try:
                    with open("dic_numeros.json", "r") as f:
                        data = json.load(f)
                        for sender_id, info in data.get("id_numeros", {}).items():
                            # Check if sender exists
                            cursor.execute("SELECT id FROM senders WHERE id = ?", (sender_id,))
                            existing = cursor.fetchone()
                            
                            sent_count_legacy = info.get("sent_count", 0)
                            
                            if not existing:
                                cursor.execute("INSERT INTO senders (id, ref_numero, status, created_at, legacy_success_count) VALUES (?, ?, ?, ?, ?)",
                                               (sender_id, info.get("ref_numero"), info.get("status"), datetime.now().isoformat(), sent_count_legacy))
                                for dialog in info.get("dialogos", []):
                                    cursor.execute("INSERT INTO sender_dialogs (sender_id, dialog_id) VALUES (?, ?)", (sender_id, dialog))
                            else:
                                # Ensure legacy count is set if it was missing or 0
                                cursor.execute("UPDATE senders SET legacy_success_count = ? WHERE id = ? AND legacy_success_count = 0", (sent_count_legacy, sender_id))

                    print("Dados importados/sincronizados do JSON.")
                except Exception as e:
                    print(f"Erro ao importar JSON: {e}")
            
            conn.commit()
            conn.close()

    def get_global_config(self):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT account_id, token_key, company_name, logo_path, endpoint_url FROM global_config WHERE id = 1")
            row = cursor.fetchone()
            conn.close()
            if row:
                return dict(row)
            return None

    def set_global_config(self, account_id, token_key, company_name, logo_path, endpoint_url="https://s17.chatguru.app/api/v1"):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM global_config WHERE id = 1")
            existing = cursor.fetchone()
            if existing:
                cursor.execute("""
                    UPDATE global_config 
                    SET account_id = ?, token_key = ?, company_name = ?, logo_path = ?, endpoint_url = ?
                    WHERE id = 1
                """, (account_id, token_key, company_name, logo_path, endpoint_url))
            else:
                cursor.execute("""
                    INSERT INTO global_config (id, account_id, token_key, company_name, logo_path, endpoint_url)
                    VALUES (1, ?, ?, ?, ?, ?)
                """, (account_id, token_key, company_name, logo_path, endpoint_url))
            conn.commit()
            conn.close()

    def get_senders(self):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM senders")
            rows = cursor.fetchall()
            
            result = {}
            for row in rows:
                sender_id = row["id"]
                # Get dialogs
                cursor.execute("SELECT dialog_id FROM sender_dialogs WHERE sender_id = ?", (sender_id,))
                dialogs = [d[0] for d in cursor.fetchall()]
                
                # Get stats (count success in message_log + legacy)
                cursor.execute("SELECT count(*) FROM message_log WHERE sender_id = ? AND status = 'success'", (sender_id,))
                log_count = cursor.fetchone()[0]
                
                total_count = log_count + (row["legacy_success_count"] or 0)
 
                # Get daily dispatches today (Brasilia Time)
                today = datetime.now(BRT).strftime("%Y-%m-%d")
                cursor.execute("SELECT count(*) FROM message_log WHERE sender_id = ? AND status = 'success' AND date = ?", (sender_id, today))
                today_count = cursor.fetchone()[0]
 
                def _col(name, default=0):
                    try:
                        v = row[name]
                        return v if v is not None else default
                    except (IndexError, KeyError):
                        return default

                daily_limit = _col("daily_limit", 0)
                hourly_limit = _col("hourly_limit", 0)
                per_second_limit = _col("per_second_limit", 0)
                meta_daily_cap = _col("meta_daily_cap", 0)
                auto_pause_failures = _col("auto_pause_failures", 5) or 5
 
                result[sender_id] = {
                    "ref_numero": row["ref_numero"],
                    "status": row["status"],
                    "daily_limit": daily_limit,
                    "today_count": today_count,
                    "dialogos": dialogs,
                    "sent_count": total_count,
                    "hourly_limit": hourly_limit,
                    "per_second_limit": per_second_limit,
                    "meta_daily_cap": meta_daily_cap,
                    "auto_pause_failures": auto_pause_failures,
                }
            conn.close()
            return {"id_numeros": result}

    def add_sender(self, sender_id, ref_numero, status="ativado"):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            try:
                cursor.execute("INSERT INTO senders (id, ref_numero, status, created_at) VALUES (?, ?, ?, ?)",
                               (sender_id, ref_numero, status, datetime.now().isoformat()))
                conn.commit()
                return True
            except sqlite3.IntegrityError:
                return False
            finally:
                conn.close()

    def update_sender_status(self, sender_id, status):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("UPDATE senders SET status = ? WHERE id = ?", (status, sender_id))
            conn.commit()
            conn.close()

    def update_sender_daily_limit(self, sender_id, limit):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("UPDATE senders SET daily_limit = ? WHERE id = ?", (limit, sender_id))
            conn.commit()
            conn.close()

    def has_sender_reached_limit(self, sender_id):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("SELECT daily_limit FROM senders WHERE id = ?", (sender_id,))
            row = cursor.fetchone()
            if not row or row[0] is None or row[0] <= 0:
                conn.close()
                return False
            daily_limit = row[0]
            
            # Count today's successful dispatches in Brasília Time
            today = datetime.now(BRT).strftime("%Y-%m-%d")
            cursor.execute("SELECT count(*) FROM message_log WHERE sender_id = ? AND status = 'success' AND date = ?", (sender_id, today))
            today_count = cursor.fetchone()[0]
            conn.close()
            
            return today_count >= daily_limit

    def delete_sender(self, sender_id):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sender_dialogs WHERE sender_id = ?", (sender_id,))
            cursor.execute("DELETE FROM atypical_templates WHERE sender_id = ?", (sender_id,))
            cursor.execute("DELETE FROM senders WHERE id = ?", (sender_id,))
            conn.commit()
            conn.close()

    def add_dialog(self, sender_id, dialog_id):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("INSERT INTO sender_dialogs (sender_id, dialog_id) VALUES (?, ?)", (sender_id, dialog_id))
            conn.commit()
            conn.close()

    def remove_dialog(self, sender_id, dialog_id):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sender_dialogs WHERE sender_id = ? AND dialog_id = ?", (sender_id, dialog_id))
            conn.commit()
            conn.close()

    def log_message(self, phone, sender_id, status, name=None, details=None):
        """Registra o envio (ou falha) com nome e detalhes"""
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            today = datetime.now().strftime("%Y-%m-%d")
            timestamp = datetime.now().isoformat()
            cursor.execute("INSERT INTO message_log (date, phone, name, sender_id, status, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
                           (today, phone, name, sender_id, status, details, timestamp))
            conn.commit()
            conn.close()

    def is_already_sent_today(self, phone, days=None):
        """Verifica se já foi enviado nos últimos N dias (status success)."""
        if days is None:
            cfg = self.get_global_config() or {}
            days = cfg.get("dedup_days", 7) or 7
        try:
            days = int(days)
        except (TypeError, ValueError):
            days = 7
        if days <= 0:
            # 0 (ou negativo) = dedup desligado
            return False
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
            cursor.execute(
                "SELECT count(*) FROM message_log WHERE date >= ? AND phone = ? AND status = 'success'",
                (since, phone)
            )
            count = cursor.fetchone()[0]
            conn.close()
            return count > 0

    # ── Limitadores por número ──
    def get_sender_limits(self, sender_id):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cols = ("hourly_limit", "per_second_limit", "daily_limit",
                    "meta_daily_cap", "auto_pause_failures")
            try:
                cursor.execute("SELECT %s FROM senders WHERE id = ?" % ", ".join(cols),
                               (str(sender_id),))
                row = cursor.fetchone()
            except sqlite3.OperationalError:
                row = None
            conn.close()
        out = {c: 0 for c in cols}
        if row:
            for c in cols:
                try:
                    out[c] = row[c] if row[c] is not None else 0
                except (IndexError, KeyError):
                    out[c] = 0
        try:
            out["auto_pause_failures"] = int(out.get("auto_pause_failures") or 5)
        except (TypeError, ValueError):
            out["auto_pause_failures"] = 5
        daily = int(out.get("daily_limit") or 0)
        cap = int(out.get("meta_daily_cap") or 0)
        out["effective_daily"] = min(daily, cap) if (daily and cap) else (daily or cap)
        return out

    def get_sender_window_counts(self, today, hour_ago_iso):
        out = {}
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            try:
                cursor.execute("""
                    SELECT sender_id,
                           sum(CASE WHEN date = ? THEN 1 ELSE 0 END) AS day_count,
                           sum(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) AS hour_count
                    FROM message_log
                    WHERE status = 'success' AND date >= ?
                    GROUP BY sender_id
                """, (today, hour_ago_iso, today))
            except sqlite3.OperationalError:
                conn.close()
                return out
            for row in cursor.fetchall():
                if not row["sender_id"]:
                    continue
                out[row["sender_id"]] = {
                    "day": int(row["day_count"] or 0),
                    "hour": int(row["hour_count"] or 0),
                }
            conn.close()
        return out

    def get_sender_quality_counts(self, since_iso):
        out = {}
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT sender_id, status, details FROM message_log WHERE timestamp >= ?",
                               (since_iso,))
            except sqlite3.OperationalError:
                conn.close()
                return out
            for row in cursor.fetchall():
                if not row["sender_id"]:
                    continue
                bucket = out.setdefault(row["sender_id"], {})
                if row["status"] == "success":
                    klass = "delivered"
                else:
                    try:
                        from rate_limit import classify_error
                        klass = classify_error({"description": row["details"] or ""})[0]
                    except Exception:
                        klass = "soft"
                bucket[klass] = bucket.get(klass, 0) + 1
            conn.close()
        return out

    # ── Leilão (Esteira) ──
    def get_leilao_state(self):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM leilao_state WHERE id = 1")
            row = cursor.fetchone()
            conn.close()
            if row:
                return dict(row)
            return {"paused": 0, "interval_seconds": 1.0, "note_template": ""}

    def set_leilao_state(self, paused=None, interval_seconds=None, note_template=None):
        # le o estado ANTES de pegar o lock (get_leilao_state ja usa self.lock)
        cur = self.get_leilao_state()
        p = cur["paused"] if paused is None else (1 if paused else 0)
        iv = cur["interval_seconds"] if interval_seconds is None else interval_seconds
        nt = cur["note_template"] if note_template is None else note_template
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE leilao_state SET paused = ?, interval_seconds = ?, note_template = ? WHERE id = 1",
                (p, iv, nt))
            conn.commit()
            conn.close()

    def get_leilao_dialogs(self):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT ld.id, ld.sender_id, ld.dialog_id, ld.created_at, s.ref_numero
                FROM leilao_dialogs ld JOIN senders s ON s.id = ld.sender_id
                ORDER BY ld.sender_id, ld.id
            """)
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return rows

    def add_leilao_dialog(self, sender_id, dialog_id):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            try:
                cursor.execute("INSERT INTO leilao_dialogs (sender_id, dialog_id, created_at) VALUES (?, ?, ?)",
                               (sender_id, dialog_id, datetime.now().isoformat()))
                conn.commit()
                return True
            except sqlite3.IntegrityError:
                return False
            finally:
                conn.close()

    def remove_leilao_dialog(self, dialog_row_id):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM leilao_dialogs WHERE id = ?", (dialog_row_id,))
            conn.commit()
            conn.close()

    def esteira_log(self, phone, name=None, cpf=None, email=None, birth_date=None,
                    product=None, campaign=None, sender_id=None, dialog_id=None,
                    status="queued", details=None, payload_json=None, source="webhook",
                    lead_id=None):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("""INSERT INTO lead_esteira_log
                (phone, name, cpf, email, birth_date, product, campaign, sender_id,
                 dialog_id, status, details, payload_json, source, created_at, lead_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                           (phone, name, cpf, email, birth_date, product, campaign,
                            sender_id, dialog_id, status, details, payload_json, source,
                            datetime.now().isoformat(), lead_id))
            log_id = cursor.lastrowid
            conn.commit()
            conn.close()
            return log_id

    def esteira_mark(self, log_id, status, details=None, sent_at=None):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            if sent_at is None:
                sent_at = datetime.now().isoformat()
            cursor.execute("UPDATE lead_esteira_log SET status = ?, details = ?, sent_at = ? WHERE id = ?",
                           (status, details, sent_at, log_id))
            conn.commit()
            conn.close()

    def esteira_get_by_lead_id(self, lead_id):
        if not lead_id:
            return None
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM lead_esteira_log WHERE lead_id = ? LIMIT 1", (lead_id,))
            row = cursor.fetchone()
            conn.close()
            return dict(row) if row else None

    def esteira_get_queued(self, limit=50):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM lead_esteira_log WHERE status = 'queued' ORDER BY id LIMIT ?", (limit,))
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return rows

    def get_leilao_log(self, limit=100):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM lead_esteira_log ORDER BY id DESC LIMIT ?", (limit,))
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return rows

    # ── Config de anotação do disparo principal por planilha ──
    def get_dispatch_config(self, sheet_name):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT note_template, column_mapping, interval_seconds FROM dispatch_sheet_config WHERE sheet_name = ?", (sheet_name,))
                row = cursor.fetchone()
            except sqlite3.OperationalError:
                row = None
            conn.close()
            if not row:
                return {}
            out = {}
            if row["note_template"] is not None:
                out["note_template"] = row["note_template"]
            if row["column_mapping"]:
                try:
                    out["column_mapping"] = json.loads(row["column_mapping"])
                except Exception:
                    out["column_mapping"] = {}
            if row["interval_seconds"] is not None:
                out["interval_seconds"] = row["interval_seconds"]
            return out

    def set_dispatch_config(self, sheet_name, note_template=None, column_mapping=None, interval_seconds=None):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("SELECT sheet_name FROM dispatch_sheet_config WHERE sheet_name = ?", (sheet_name,))
            exists = cursor.fetchone()
            if exists:
                updates = []
                params = []
                if note_template is not None:
                    updates.append("note_template = ?")
                    params.append(note_template)
                if column_mapping is not None:
                    updates.append("column_mapping = ?")
                    params.append(json.dumps(column_mapping))
                if interval_seconds is not None:
                    updates.append("interval_seconds = ?")
                    params.append(interval_seconds)
                if updates:
                    updates.append("updated_at = ?")
                    params.append(datetime.now().isoformat())
                    params.append(sheet_name)
                    cursor.execute("UPDATE dispatch_sheet_config SET %s WHERE sheet_name = ?" % ", ".join(updates), params)
            else:
                cursor.execute("""INSERT INTO dispatch_sheet_config
                    (sheet_name, note_template, column_mapping, interval_seconds, updated_at)
                    VALUES (?, ?, ?, ?, ?)""",
                               (sheet_name, note_template, json.dumps(column_mapping or {}),
                                interval_seconds if interval_seconds is not None else 1.0,
                                datetime.now().isoformat()))
            conn.commit()
            conn.close()

    def get_todays_history(self):
        """Retorna lista de numeros processados hoje para controle da memória se necessário, 
           mas idealmente usamos is_already_sent_today direto no banco"""
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            today = datetime.now().strftime("%Y-%m-%d")
            cursor.execute("SELECT phone FROM message_log WHERE date = ? AND status='success'", (today,))
            rows = cursor.fetchall()
            conn.close()
            return [r[0] for r in rows]

    def get_history_stats(self):
        """Retorna estatísticas agrupadas por data e remetente"""
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Agrupa por Data, Remetente e Status
            cursor.execute('''
                SELECT date, sender_id, status, count(*) as count 
                FROM message_log 
                GROUP BY date, sender_id, status
                ORDER BY date DESC
            ''')
            rows = cursor.fetchall()
            
            # Processa para formato amigável ao frontend
            # Estrutura: { "2023-10-27": { "sender_id_1": { "success": 10, "failed": 2 }, ... } }
            history = {}
            
            # Preciso dos nomes dos remetentes
            cursor.execute("SELECT id, ref_numero FROM senders")
            senders = {r["id"]: r["ref_numero"] for r in cursor.fetchall()}
            
            for row in rows:
                date = row["date"]
                sender_id = row["sender_id"] or "unknown"
                status = row["status"]
                count = row["count"]
                
                if date not in history:
                    history[date] = {}
                
                if sender_id not in history[date]:
                    history[date][sender_id] = {
                        "name": senders.get(sender_id, "Desconhecido"),
                        "success": 0, 
                        "failed": 0
                    }
                
                if status == "success":
                    history[date][sender_id]["success"] += count
                else:
                    history[date][sender_id]["failed"] += count
            
            conn.close()
            return history

    def get_daily_failures(self):
        """Retorna todas as falhas do dia atual"""
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            today = datetime.now().strftime("%Y-%m-%d")
            cursor.execute('''
                SELECT m.phone, m.name, m.details, m.timestamp, s.ref_numero as sender_name
                FROM message_log m
                LEFT JOIN senders s ON m.sender_id = s.id
                WHERE m.date = ? AND m.status = 'failed'
                ORDER BY m.timestamp DESC
            ''', (today,))
            rows = cursor.fetchall()
            conn.close()
            return [dict(r) for r in rows]

    # ─── Atypical Templates ───

    def get_atypical_templates(self):
        """Retorna todos os templates atípicos agrupados por sender_id"""
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT at.*, s.ref_numero 
                FROM atypical_templates at 
                LEFT JOIN senders s ON at.sender_id = s.id
                ORDER BY at.sender_id
            """)
            rows = cursor.fetchall()
            conn.close()
            return [dict(r) for r in rows]

    def add_atypical_template(self, sender_id, dialog_id, label="", status="ativado"):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO atypical_templates (sender_id, dialog_id, label, status, created_at) VALUES (?, ?, ?, ?, ?)",
                (sender_id, dialog_id, label, status, datetime.now().isoformat())
            )
            new_id = cursor.lastrowid
            conn.commit()
            conn.close()
            return new_id

    def update_atypical_template(self, template_id, dialog_id=None, label=None, status=None):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            updates = []
            params = []
            if dialog_id is not None:
                updates.append("dialog_id = ?")
                params.append(dialog_id)
            if label is not None:
                updates.append("label = ?")
                params.append(label)
            if status is not None:
                updates.append("status = ?")
                params.append(status)
            if updates:
                params.append(template_id)
                cursor.execute(f"UPDATE atypical_templates SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
            conn.close()

    def delete_atypical_template(self, template_id):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM atypical_templates WHERE id = ?", (template_id,))
            conn.commit()
            conn.close()

    def get_active_atypical_senders(self):
        """Retorna remetentes ativos com seus templates atípicos"""
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT at.sender_id, at.dialog_id, s.ref_numero
                FROM atypical_templates at
                JOIN senders s ON at.sender_id = s.id
                WHERE at.status = 'ativado' AND s.status = 'ativado'
            """)
            rows = cursor.fetchall()
            conn.close()
            return [dict(r) for r in rows]

    # ─── Atypical Tasks ───

    def create_atypical_task(self, file_path, phone_column, name_column, note_template,
                              column_mapping, total, phone_column_fallback=None,
                              scheduled_at=None, created_by=None):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            status = "scheduled" if scheduled_at else "pending"
            cursor.execute("""
                INSERT INTO atypical_tasks 
                (status, scheduled_at, file_path, phone_column, phone_column_fallback,
                 name_column, note_template, column_mapping, total, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (status, scheduled_at, file_path, phone_column, phone_column_fallback,
                  name_column, note_template, json.dumps(column_mapping),
                  total, datetime.now().isoformat(), created_by))
            task_id = cursor.lastrowid
            conn.commit()
            conn.close()
            return task_id

    def get_atypical_tasks(self):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM atypical_tasks ORDER BY created_at DESC")
            rows = cursor.fetchall()
            conn.close()
            result = []
            for r in rows:
                d = dict(r)
                try:
                    d["column_mapping"] = json.loads(d.get("column_mapping", "{}"))
                except:
                    d["column_mapping"] = {}
                try:
                    d["logs"] = json.loads(d.get("logs", "[]"))
                except:
                    d["logs"] = []
                result.append(d)
            return result

    def get_atypical_task(self, task_id):
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM atypical_tasks WHERE id = ?", (task_id,))
            row = cursor.fetchone()
            conn.close()
            if row:
                d = dict(row)
                try:
                    d["column_mapping"] = json.loads(d.get("column_mapping", "{}"))
                except:
                    d["column_mapping"] = {}
                try:
                    d["logs"] = json.loads(d.get("logs", "[]"))
                except:
                    d["logs"] = []
                return d
            return None

    def update_atypical_task_status(self, task_id, status, started_at=None, completed_at=None):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            updates = ["status = ?"]
            params = [status]
            if started_at:
                updates.append("started_at = ?")
                params.append(started_at)
            if completed_at:
                updates.append("completed_at = ?")
                params.append(completed_at)
            params.append(task_id)
            cursor.execute(f"UPDATE atypical_tasks SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
            conn.close()

    def update_atypical_task_progress(self, task_id, processed, success, failed, skipped, logs=None):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            if logs is not None:
                cursor.execute(
                    "UPDATE atypical_tasks SET processed = ?, success = ?, failed = ?, skipped = ?, logs = ? WHERE id = ?",
                    (processed, success, failed, skipped, json.dumps(logs[-15:]), task_id)
                )
            else:
                cursor.execute(
                    "UPDATE atypical_tasks SET processed = ?, success = ?, failed = ?, skipped = ? WHERE id = ?",
                    (processed, success, failed, skipped, task_id)
                )
            conn.commit()
            conn.close()

    def delete_atypical_task(self, task_id):
        with self.lock:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM atypical_tasks WHERE id = ?", (task_id,))
            conn.commit()
            conn.close()

    def get_pending_atypical_tasks(self):
        """Retorna tarefas agendadas prontas para executar"""
        with self.lock:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute(
                "SELECT * FROM atypical_tasks WHERE status = 'scheduled' AND scheduled_at <= ?",
                (now,)
            )
            rows = cursor.fetchall()
            conn.close()
            result = []
            for r in rows:
                d = dict(r)
                try:
                    d["column_mapping"] = json.loads(d.get("column_mapping", "{}"))
                except:
                    d["column_mapping"] = {}
                result.append(d)
            return result
