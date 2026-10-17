"""Leilão (Esteira) para o disparador ChatGuru.

Mesmo contrato do app VendeAI (/webhook/leilao), mesma tabela lead_esteira_log,
mesma semântica de pause/queue/drain/throttle. A diferença é o envio, que no
ChatGuru é chat_add + note_add + dialog_execute (em vez de /mailing/send/).

Tudo passa pelo limitador único do processo, então os tetos por número valem
para o leilão também.
"""
import json
import threading
import time
import queue
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel

from database import Database
from chatguru import (
    formatar_numero_completo, cadastrar_chat, verificar_status_cadastro,
    enviar_dialogo, adicionar_anotacao,
)
from rate_limit import get_limiter, classify_error
from notes import build_note_text

BRT = None
try:
    from database import BRT as _BRT
    BRT = _BRT
except Exception:
    from datetime import timezone, timedelta
    BRT = timezone(timedelta(hours=-3))


class LeilaoLead(BaseModel):
    """Lead do sistema de Leilao (contrato igual ao do app VendeAI)."""
    lead_id: Optional[str] = None
    cpf: Optional[str] = None
    nome: Optional[str] = None
    matricula: Optional[str] = None
    valor_num: Optional[float] = None
    prazo_desejado_parcelas: Optional[int] = None
    origem: Optional[str] = None
    tempo_vinculo_meses: Optional[int] = None
    margem_disponivel: Optional[float] = None
    celulares: Optional[Any] = None
    qualifica: Optional[Any] = None
    cnpj_empregador: Optional[str] = None
    nome_empresa: Optional[str] = None
    tipo_empregador: Optional[str] = None
    cnaes_empregador: Optional[str] = None

    class Config:
        extra = "allow"   # o sistema externo pode mandar campos a mais


LEAD_VARS = ["lead_id", "cpf", "nome", "primeiro_nome", "matricula",
             "valor_num", "prazo_desejado_parcelas", "origem",
             "tempo_vinculo_meses", "margem_disponivel", "celulares",
             "qualifica", "cnpj_empregador", "nome_empresa",
             "tipo_empregador", "cnaes_empregador"]


def _lead_view(raw):
    raw = raw or {}
    view = {k: ("" if raw.get(k) is None else str(raw.get(k))) for k in LEAD_VARS if k != "primeiro_nome"}
    nome = view.get("nome", "")
    view["primeiro_nome"] = nome.split(" ")[0] if nome else ""
    return view


def _render_lead_note(template, raw):
    if not template:
        return None
    view = _lead_view(raw)
    out = template
    for k, v in view.items():
        out = out.replace("{" + k + "}", v)
    return out


def _leilao_phones(celulares):
    if celulares is None:
        return []
    if isinstance(celulares, (int, float)):
        return [str(int(celulares)) if isinstance(celulares, float) else str(celulares)]
    if isinstance(celulares, list):
        out = []
        for item in celulares:
            out.extend(_leilao_phones(item))
        return out
    text = str(celulares)
    return [p for p in __import__("re").split(r"[;/|,\s]+", text) if p]


def _phone_candidates(phone):
    """Formatos que o mesmo telefone pode ter no message_log.

    O disparo principal grava o numero_alvo (55+DDD+8 ou 9 digitos) e o
    leilao grava o +55 normalizado. O dedup precisa olhar todos.
    """
    out = []
    raw = "".join(c for c in str(phone or "") if c.isdigit())
    if raw:
        out.append(raw)
        fmt = formatar_numero_completo(raw)
        if fmt:
            for n in fmt:
                if n not in out:
                    out.append(n)
    if phone and str(phone) not in out:
        out.append(str(phone))
    return out


def _was_sent(db, phone, days=None):
    for candidate in _phone_candidates(phone):
        try:
            if db.is_already_sent_today(candidate, days=days):
                return True
        except TypeError:
            if db.is_already_sent_today(candidate):
                return True
    return False


def _next_leilao_pair(db, preferred_sender_id=None):
    """Round-robin entre (sender_id, dialog_id) configurados para o leilão."""
    global _LEILAO_RR_INDEX
    try:
        pairs = db.get_leilao_dialogs()
    except Exception:
        pairs = []
    if preferred_sender_id:
        pairs = [p for p in pairs if str(p.get("sender_id")) == str(preferred_sender_id)] or pairs
    if not pairs:
        return None
    with _LEILAO_RR_LOCK:
        p = pairs[_LEILAO_RR_INDEX % len(pairs)]
        _LEILAO_RR_INDEX += 1
    return p


_LEILAO_RR_INDEX = 0
_LEILAO_RR_LOCK = threading.Lock()
_DRAIN_LOCK = threading.Lock()
_DRAINING = [False]


class LeilaoService:
    def __init__(self, db=None):
        if db is None:
            db = Database()
        self.db = db

    def _cred(self):
        return self.db.get_global_config()

    def _throttle(self):
        try:
            st = self.db.get_leilao_state()
            interval = float(st.get("interval_seconds") or 0)
        except Exception:
            interval = 0
        if interval <= 0:
            return
        with _LEILAO_THROTTLE_LOCK:
            now = time.time()
            wait = interval - (now - _LEILAO_LAST_SEND[0])
            if wait > 0:
                time.sleep(wait)
            _LEILAO_LAST_SEND[0] = time.time()

    def receive_lead(self, lead_raw, svc=None):
        """Webhook: recebe o lead e dispara (ou enfileira se pausado)."""
        lead = lead_raw or {}
        # Idempotência por lead_id
        lid = lead.get("lead_id")
        if lid:
            existing = self.db.esteira_get_by_lead_id(lid)
            if existing:
                return {"status": existing.get("status"), "id": existing.get("id"),
                        "phone": existing.get("phone"), "duplicate_lead_id": True}

        q = lead.get("qualifica")
        qualified = q in (True, "true", "True", "TRUE", 1, "1") if not isinstance(q, bool) else bool(q)
        if not qualified:
            log_id = self.db.esteira_log(
                phone=";".join(_leilao_phones(lead.get("celulares")))[:60] or None,
                name=lead.get("nome"), cpf=lead.get("cpf"), campaign=lead.get("origem"),
                status="skipped", details="filtro qualifica=false",
                payload_json=json.dumps(lead, ensure_ascii=False),
                source="webhook", lead_id=lid)
            return {"status": "skipped", "id": log_id, "reason": "qualifica=false"}

        normalized = None
        for candidate in _leilao_phones(lead.get("celulares")):
            # usa a MESMA regra do disparo principal (12 e 13 digitos)
            fmt = formatar_numero_completo(candidate)
            if fmt:
                normalized = "+" + fmt[0]
                break
        if not normalized:
            log_id = self.db.esteira_log(
                phone=str(lead.get("celulares"))[:60], name=lead.get("nome"),
                cpf=lead.get("cpf"), campaign=lead.get("origem"),
                status="failed", details="invalid_phone",
                payload_json=json.dumps(lead, ensure_ascii=False),
                source="webhook", lead_id=lid)
            return {"status": "failed", "id": log_id}

        if _was_sent(self.db, normalized):
            log_id = self.db.esteira_log(
                phone=normalized, name=lead.get("nome"), cpf=lead.get("cpf"),
                campaign=lead.get("origem"), status="skipped",
                details="dedup: recently sent",
                payload_json=json.dumps(lead, ensure_ascii=False),
                source="webhook", lead_id=lid)
            return {"status": "skipped", "id": log_id, "phone": normalized}

        try:
            paused = bool(self.db.get_leilao_state().get("paused"))
        except Exception:
            paused = False
        if paused:
            log_id = self.db.esteira_log(
                phone=normalized, name=lead.get("nome"), cpf=lead.get("cpf"),
                campaign=lead.get("origem"), status="queued",
                details="paused: aguardando retomada",
                payload_json=json.dumps({"lead": lead}, ensure_ascii=False),
                source="webhook", lead_id=lid)
            return {"status": "queued", "id": log_id, "phone": normalized}

        return self._send_now(normalized, lead, lid)

    def _send_now(self, phone, lead, lid):
        cred = self._cred()
        if not cred or not cred.get("account_id") or not cred.get("token_key"):
            log_id = self.db.esteira_log(phone=phone, name=lead.get("nome"),
                                         cpf=lead.get("cpf"), campaign=lead.get("origem"),
                                         status="failed", details="missing_credentials",
                                         payload_json=json.dumps({"lead": lead}, ensure_ascii=False),
                                         source="webhook", lead_id=lid)
            return {"status": "failed", "id": log_id, "phone": phone}

        pair = _next_leilao_pair(self.db)
        if not pair:
            log_id = self.db.esteira_log(phone=phone, name=lead.get("nome"),
                                         cpf=lead.get("cpf"), campaign=lead.get("origem"),
                                         status="failed", details="no_leilao_dialog: configure em Leilão",
                                         payload_json=json.dumps({"lead": lead}, ensure_ascii=False),
                                         source="webhook", lead_id=lid)
            return {"status": "failed", "id": log_id, "phone": phone, "error": "no_leilao_dialog"}

        sender_id = pair["sender_id"]
        dialog_id = pair["dialog_id"]

        # round-robin respeita o teto por número
        limiter = get_limiter(self.db)
        limiter.seed()
        limiter.configure(sender_id,
                          per_second_limit=self._sender_limit(sender_id, "per_second_limit"),
                          hourly_limit=self._sender_limit(sender_id, "hourly_limit"),
                          daily_limit=self._sender_limit(sender_id, "daily_limit"),
                          meta_daily_cap=self._sender_limit(sender_id, "meta_daily_cap"))
        ok_slot, decision = self._wait_slot(sender_id)
        if not ok_slot:
            log_id = self.db.esteira_log(phone=phone, name=lead.get("nome"),
                                         cpf=lead.get("cpf"), campaign=lead.get("origem"),
                                         sender_id=sender_id, dialog_id=dialog_id,
                                         status="failed",
                                         details="limit_hit: todos os numeros no %s" % (decision.reason if decision else "teto"),
                                         payload_json=json.dumps({"lead": lead}, ensure_ascii=False),
                                         source="webhook", lead_id=lid)
            return {"status": "failed", "id": log_id, "phone": phone, "error": "limit_hit"}

        log_id = self.db.esteira_log(phone=phone, name=lead.get("nome"),
                                     cpf=lead.get("cpf"), product="clt",
                                     campaign=lead.get("origem") or "leilao",
                                     sender_id=sender_id, dialog_id=dialog_id,
                                     status="queued",
                                     payload_json=json.dumps({"lead": lead}, ensure_ascii=False),
                                     source="webhook", lead_id=lid)

        self._throttle()
        try:
            formatado = formatar_numero_completo(phone.replace("+", ""))
            if not formatado:
                raise ValueError("numero invalido")
            num_12, num_13 = formatado
            ddd = int(num_12[2:4])
            numero_alvo = num_13 if 11 <= ddd <= 29 else num_12

            note_text = None
            try:
                st = self.db.get_leilao_state()
                note_text = _render_lead_note(st.get("note_template"), lead)
            except Exception:
                note_text = None

            # chat_add (registra o contato) — idempotente: se já existe, dialog_execute funciona direto
            resp = enviar_dialogo(cred, numero_alvo, dialog_id, sender_id)
            if resp.get("code") == 400 and "Chat não encontrado" in (resp.get("description") or ""):
                reg = cadastrar_chat(cred, numero_alvo, lead.get("nome") or "", sender_id, dialog_id=dialog_id)
                chat_add_id = reg.get("chat_add_id")
                if chat_add_id:
                    for _ in range(45):
                        st_req = verificar_status_cadastro(cred, chat_add_id, sender_id, numero_alvo)
                        if st_req.get("chat_add_status") in ("success", "done"):
                            time.sleep(1)
                            break
                        if st_req.get("chat_add_status") in ("error", "invalid"):
                            break
                        time.sleep(1)
                resp = enviar_dialogo(cred, numero_alvo, dialog_id, sender_id)

            ok = resp.get("code") == 200
            if note_text:
                try:
                    adicionar_anotacao(cred, numero_alvo, note_text, sender_id)
                except Exception:
                    pass
            limiter.record(sender_id, ok=ok,
                           kind=None if ok else classify_error(resp)[0])
            if ok:
                self.db.esteira_mark(log_id, "sent")
                self.db.log_message(numero_alvo, sender_id, "success", name=lead.get("nome"),
                                    details="Leilão ChatGuru")
                return {"status": "sent", "id": log_id, "phone": phone, "sender_id": sender_id}
            self.db.esteira_mark(log_id, "failed", str(resp)[:2000])
            self.db.log_message(numero_alvo, sender_id, "failed", name=lead.get("nome"),
                                details=str(resp)[:500])
            return {"status": "failed", "id": log_id, "phone": phone, "sender_id": sender_id,
                    "error": resp.get("description")}
        except Exception as e:
            limiter.record(sender_id, ok=False, kind="soft")
            self.db.esteira_mark(log_id, "failed", str(e)[:2000])
            self.db.log_message(numero_alvo, sender_id, "failed", name=lead.get("nome"), details=str(e)[:500])
            return {"status": "failed", "id": log_id, "phone": phone, "error": str(e)}

    def _sender_limit(self, sender_id, field):
        try:
            return self.db.get_sender_limits(sender_id).get(field, 0) or 0
        except Exception:
            return 0

    def _wait_slot(self, sender_id, max_wait=65):
        limiter = get_limiter(self.db)
        deadline = time.time() + max_wait
        while True:
            d = limiter.check(sender_id)
            if d.allowed:
                return True, None
            if d.reason == "por_segundo" and d.wait > 0 and time.time() < deadline:
                time.sleep(min(d.wait, 2.0))
                continue
            if d.reason == "por_hora" and 0 < d.wait <= max_wait and time.time() < deadline:
                time.sleep(min(d.wait, 10.0))
                continue
            return False, d

    def drain_queued(self):
        if _DRAINING[0]:
            return
        _DRAINING[0] = True
        try:
            while True:
                try:
                    if bool(self.db.get_leilao_state().get("paused")):
                        break
                except Exception:
                    break
                batch = self.db.esteira_get_queued(limit=50)
                if not batch:
                    break
                for row in batch:
                    try:
                        if bool(self.db.get_leilao_state().get("paused")):
                            break
                    except Exception:
                        break
                    phone = row.get("phone")
                    if not phone or _was_sent(self.db, phone):
                        self.db.esteira_mark(row["id"], "skipped",
                                             "drenagem: dedup no momento do envio")
                        continue
                    raw = {}
                    try:
                        raw = json.loads(row.get("payload_json") or "{}").get("lead", {}) or {}
                    except Exception:
                        raw = {}
                    self._send_now(phone, raw or {"nome": row.get("name")}, row.get("lead_id"))
        finally:
            _DRAINING[0] = False

    def pause(self):
        self.db.set_leilao_state(paused=True)

    def resume(self):
        self.db.set_leilao_state(paused=False)
        threading.Thread(target=self.drain_queued, daemon=True).start()

    def get_log(self, limit=100):
        return self.db.get_leilao_log(limit=limit)


_LEILAO_THROTTLE_LOCK = threading.Lock()
_LEILAO_LAST_SEND = [0.0]
