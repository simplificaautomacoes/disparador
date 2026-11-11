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
from typing import Any, Optional

from pydantic import BaseModel

from database import Database
from chatguru import (
    formatar_numero_completo, cadastrar_chat, verificar_status_cadastro,
    enviar_dialogo, adicionar_anotacao,
)
from rate_limit import get_limiter, classify_error
from auction_profiles import AuctionProfiles, profile_for, render_lead

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

    model_config = {"extra": "allow"}


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
    pairs = [p for p in pairs if p.get("sender_status", "ativado") == "ativado"]
    if not pairs:
        return None
    with _LEILAO_RR_LOCK:
        p = pairs[_LEILAO_RR_INDEX % len(pairs)]
        _LEILAO_RR_INDEX += 1
    return p


_LEILAO_RR_INDEX = 0
_LEILAO_RR_LOCK = threading.Lock()
_DRAIN_LOCK = threading.Lock()
_LEILAO_SEND_LOCK = threading.RLock()


class LeilaoService:
    def __init__(self, db=None):
        if db is None:
            db = Database()
        self.db = db
        self.profiles = AuctionProfiles(db)

    def _cred(self):
        return self.db.get_global_config()

    def _throttle(self, auction_id="padrao"):
        try:
            st = self.profiles.state(auction_id)
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

    def receive_lead(self, lead_raw, svc=None, pair_override=None):
        """Persiste primeiro, para uma repetição do webhook não disparar de novo."""
        lead = dict(lead_raw or {})
        auction_id = profile_for(lead)
        state = self.profiles.state(auction_id)
        lead["leilao_id"] = auction_id
        q = lead.get("qualifica")
        qualified = q in (True, "true", "True", "TRUE", 1, "1")
        phone = next(("+" + fmt[0] for candidate in _leilao_phones(lead.get("celulares"))
                      if (fmt := formatar_numero_completo(candidate))), None)
        status, details = "queued", None
        if not qualified:
            status, details = "skipped", "filtro qualifica=false"
        elif not phone:
            status, details = "failed", "invalid_phone"
        row, duplicate = self.db.esteira_receive(phone, lead, status, details)
        if duplicate:
            return {"status": row["status"], "id": row["id"], "phone": row["phone"],
                    "duplicate_lead_id": True}
        if status != "queued" or state.get("paused"):
            return {"status": status, "id": row["id"], "phone": phone}
        return self._send_now(phone, lead, lead.get("lead_id"), row["id"], pair_override)

    def _send_now(self, phone, lead, lid, log_id, pair_override=None):
        fmt = formatar_numero_completo(phone)
        if not fmt:
            self.db.esteira_mark(log_id, "failed", "invalid_phone")
            return {"status": "failed", "id": log_id}
        if not self.db.esteira_claim(log_id, fmt[0]):
            row = self.db.esteira_get(log_id)
            return {"status": row["status"], "id": log_id, "busy": True}
        try:
            if _was_sent(self.db, phone):
                self.db.esteira_mark(log_id, "skipped", "dedup: recently sent")
                return {"status": "skipped", "id": log_id, "phone": phone}
            # Seleção do remetente, consulta do limite e registro são serializados.
            with _LEILAO_SEND_LOCK:
                return self._dispatch_claimed(phone, lead, lid, log_id, pair_override)
        except Exception as exc:
            # O processo pode ter falhado depois de enviar. Não reenviar automaticamente.
            self.db.esteira_mark(log_id, "unknown", str(exc)[:2000])
            return {"status": "unknown", "id": log_id, "error": str(exc)}
        finally:
            row = self.db.esteira_get(log_id)
            if row and row["status"] not in ("processing", "unknown"):
                self.db.esteira_release(log_id)

    def _dispatch_claimed(self, phone, lead, lid, log_id, pair_override=None):
        cred = self._cred()
        if not cred or not cred.get("account_id") or not cred.get("token_key"):
            self.db.esteira_mark(log_id, "failed", "missing_credentials")
            return {"status": "failed", "id": log_id, "phone": phone}

        pair = pair_override or _next_leilao_pair(self.db)
        if not pair:
            self.db.esteira_mark(log_id, "failed", "no_leilao_dialog: configure em Leilão")
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
        if not ok_slot and not pair_override:
            tried = {sender_id}
            for _ in range(len(self.db.get_leilao_dialogs())):
                candidate = _next_leilao_pair(self.db)
                if not candidate or candidate["sender_id"] in tried:
                    continue
                tried.add(candidate["sender_id"])
                candidate_id = candidate["sender_id"]
                limiter.configure(candidate_id, **{field: self._sender_limit(candidate_id, field)
                    for field in ("per_second_limit", "hourly_limit", "daily_limit", "meta_daily_cap")})
                ok_slot, decision = self._wait_slot(candidate_id)
                if ok_slot:
                    sender_id, dialog_id = candidate_id, candidate["dialog_id"]
                    break
        if not ok_slot:
            self.db.esteira_mark(log_id, "failed", "limit_hit: %s" % (decision.reason if decision else "teto"))
            return {"status": "failed", "id": log_id, "phone": phone, "error": "limit_hit"}

        self.db.esteira_set_sender(log_id, sender_id, dialog_id)

        self._throttle(profile_for(lead))
        try:
            formatado = formatar_numero_completo(phone.replace("+", ""))
            if not formatado:
                raise ValueError("numero invalido")
            num_12, num_13 = formatado
            ddd = int(num_12[2:4])
            numero_alvo = num_13 if 11 <= ddd <= 29 else num_12

            st = self.profiles.state(profile_for(lead))
            note_text = render_lead(st.get("note_template"), lead)

            alternate = num_12 if numero_alvo == num_13 else num_13
            # A IA do diálogo precisa encontrar a anotação antes de iniciar o atendimento.
            resp = adicionar_anotacao(cred, numero_alvo, note_text, sender_id) if note_text else {"code": 200}
            registered = False
            if self._missing_chat(resp):
                numero_alvo, resp = self._register_contact(cred, numero_alvo, alternate, lead, sender_id)
                registered = True
                if numero_alvo and note_text:
                    resp = adicionar_anotacao(cred, numero_alvo, note_text, sender_id)
            if resp.get("code") in (200, 201):
                resp = enviar_dialogo(cred, numero_alvo, dialog_id, sender_id)
                if self._missing_chat(resp) and not registered:
                    numero_alvo, resp = self._register_contact(cred, numero_alvo, alternate, lead, sender_id)
                    if numero_alvo:
                        resp = adicionar_anotacao(cred, numero_alvo, note_text, sender_id) if note_text else {"code": 200}
                        if resp.get("code") in (200, 201):
                            resp = enviar_dialogo(cred, numero_alvo, dialog_id, sender_id)
                            if self._missing_chat(resp):
                                # Uma rejeição explícita não executou o diálogo; pode tentar o outro formato.
                                fallback = num_12 if numero_alvo == num_13 else num_13
                                note_resp = adicionar_anotacao(cred, fallback, note_text, sender_id) if note_text else {"code": 200}
                                if note_resp.get("code") in (200, 201):
                                    numero_alvo = fallback
                                    resp = enviar_dialogo(cred, numero_alvo, dialog_id, sender_id)

            ok = resp.get("code") == 200
            limiter.record(sender_id, ok=ok,
                           kind=None if ok else classify_error(resp)[0])
            if ok:
                self.db.log_message(numero_alvo, sender_id, "success", name=lead.get("nome"),
                                    details="Leilão ChatGuru")
                self.db.esteira_mark(log_id, "sent")
                return {"status": "sent", "id": log_id, "phone": phone, "sender_id": sender_id}
            outcome = "unknown" if resp.get("outcome_unknown") else "failed"
            self.db.esteira_mark(log_id, outcome, str(resp)[:2000])
            self.db.log_message(numero_alvo or phone, sender_id, "failed", name=lead.get("nome"),
                                details=str(resp)[:500])
            return {"status": outcome, "id": log_id, "phone": phone, "sender_id": sender_id,
                    "error": resp.get("description")}
        except Exception as e:
            limiter.record(sender_id, ok=False, kind="soft")
            self.db.esteira_mark(log_id, "unknown", str(e)[:2000])
            self.db.log_message(numero_alvo, sender_id, "failed", name=lead.get("nome"), details=str(e)[:500])
            return {"status": "unknown", "id": log_id, "phone": phone, "error": str(e)}

    @staticmethod
    def _missing_chat(resp):
        import re
        return resp.get("code") == 400 and bool(re.search(r"chat n.o encontrado", resp.get("description") or "", re.IGNORECASE))

    def _register_contact(self, cred, phone, alternate, lead, sender_id):
        response = {}
        for candidate in dict.fromkeys([phone, alternate]):
            response = cadastrar_chat(cred, candidate, lead.get("nome") or "", sender_id)
            request_id = response.get("chat_add_id")
            if request_id:
                for _ in range(45):
                    response = verificar_status_cadastro(cred, request_id, sender_id, candidate)
                    if response.get("chat_add_status") in ("success", "done"):
                        time.sleep(1)
                        return candidate, {"code": 200}
                    if response.get("chat_add_status") in ("error", "invalid"):
                        break
                    time.sleep(1)
                break
            if response.get("outcome_unknown"):
                break
        return None, {"code": 400, "description": "Cadastro não concluído: " + str(response)}

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
        if not _DRAIN_LOCK.acquire(blocking=False):
            return
        try:
            while True:
                progressed = False
                for profile in self.profiles.list():
                    key = profile["id"]
                    if self.profiles.state(key).get("paused"):
                        continue
                    for row in self.db.esteira_get_queued(limit=50, auction_id=key):
                        if self.profiles.state(key).get("paused"):
                            break
                        try:
                            payload = json.loads(row.get("payload_json") or "{}")
                            raw = payload.get("lead", payload) or {}
                        except (ValueError, TypeError):
                            self.db.esteira_mark(row["id"], "failed", "Payload salvo inválido")
                            progressed = True
                            continue
                        raw["leilao_id"] = key
                        result = self._send_now(row.get("phone"), raw, row.get("lead_id"), row["id"])
                        progressed = progressed or not result.get("busy")
                if not progressed:
                    break
        finally:
            _DRAIN_LOCK.release()

    def start_drain(self):
        threading.Thread(target=self.drain_queued, daemon=True).start()

    def retry_failed(self, log_ids, auction_id="padrao", confirmed_not_sent=False):
        state = self.profiles.state(auction_id)
        ids = self.db.esteira_retry(log_ids, auction_id, confirmed_not_sent)
        if ids and not state.get("paused"):
            threading.Thread(target=self.drain_queued, daemon=True).start()
        return {"queued": len(ids), "ids": ids}

    def pause(self):
        self.db.set_leilao_state(paused=True)

    def resume(self):
        self.db.set_leilao_state(paused=False)
        threading.Thread(target=self.drain_queued, daemon=True).start()

    def get_log(self, limit=100):
        return self.db.get_leilao_log(limit=limit)


_LEILAO_THROTTLE_LOCK = threading.Lock()
_LEILAO_LAST_SEND = [0.0]
