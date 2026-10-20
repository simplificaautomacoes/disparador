"""Limitadores de envio por número e qualidade em tempo real.

Mesma lógica do app VendeAI, adaptada ao formato de resposta do ChatGuru
({"code", "result", "description"}). Três limitadores independentes:

  1. por segundo (per_second_limit) — fracionário: 0.5 = 1 msg a cada 2s
  2. por hora    (hourly_limit)     — janela deslizante de 3600s
  3. por dia     (daily_limit)      — dia civil em Brasília

Mais a qualidade observada, calculada com os resultados reais dos envios.
"""
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone

BRT = timezone(timedelta(hours=-3))

QUALITY_MIN_SAMPLES = 10
QUALITY_GREEN = 85.0
QUALITY_YELLOW = 60.0
QUALITY_WINDOW = 24 * 3600
QUALITY_MAX_EVENTS = 300
DEFAULT_AUTO_PAUSE_FAILURES = 5
MAX_WAIT = 900


def classify_error(resp):
    """Traduz a resposta da API ChatGuru em (classe, texto curto).

    classe: "ok" | "block" | "reject" | "soft" | "config"
    """
    if resp is None:
        return "soft", "sem resposta da API"
    code = resp.get("code")
    result = (resp.get("result") or "").lower()
    raw = " ".join(
        str(resp.get(k) or "") for k in ("error", "description", "message", "details", "reason")
    ).strip()
    low = raw.lower()

    if code in (200, 201) or result == "success":
        return "ok", ""
    # credencial / acesso
    # ChatGuru devolve "Chave key invalida", "account_id invalido" etc. (sem acento)
    if "key" in low and ("inválid" in low or "invalid" in low):
        return "config", (raw or "credencial inválida")[:200]
    if "account_id" in low and ("inválid" in low or "invalid" in low):
        return "config", (raw or "account_id inválida")[:200]
    if ("inválid" in low or "invalid" in low) and "phone" in low:
        return "config", (raw or "configuração inválida")[:200]
    if "unauthorized" in low or "forbidden" in low or "permiss" in low and "negad" in low:
        return "config", (raw or "acesso negado")[:200]
    # ChatGuru: diálogo não existe = erro de configuração nossa
    if "diálogo não encontrado" in low or "dialogo não encontrado" in low or "dialogo nao encontrado" in low:
        return "reject", (raw or "diálogo não encontrado")[:200]
    # ChatGuru: número inválido no WhatsApp = problema do contato
    if "inválid" in low or "invalid" in low or "não encontrado" in low:
        return "soft", (raw or "número inválido")[:200]
    # rate limit
    if "limite" in low or "rate" in low or "too many" in low or "429" in low:
        return "block", (raw or "rate limit")[:200]
    if code == 429:
        return "block", (raw or "rate_limited")[:200]
    if code in (502, 503, 504) or "upstream" in low or "connection" in low or "timeout" in low:
        return "soft", (raw or "ChatGuru instável")[:200]
    # keywords genéricas
    if any(k in low for k in ("spam", "ban", "bloquead")):
        return "block", raw[:200]
    return "soft", (raw or "erro desconhecido da API")[:200]


class Decision(object):
    __slots__ = ("allowed", "reason", "wait", "used", "limit", "detail")

    def __init__(self, allowed, reason="ok", wait=0.0, used=0, limit=0, detail=""):
        self.allowed = allowed
        self.reason = reason
        self.wait = wait
        self.used = used
        self.limit = limit
        self.detail = detail

    def as_dict(self):
        return {"allowed": self.allowed, "reason": self.reason,
                "wait": round(self.wait, 1), "used": self.used, "limit": self.limit,
                "detail": self.detail}

    def __repr__(self):
        return "<Decision %s %s %s/%s wait=%.1f>" % (
            "OK" if self.allowed else "BLOQUEADO", self.reason, self.used, self.limit, self.wait)


class _Sender(object):
    __slots__ = ("limits", "window", "events", "day", "day_key", "streak_fail", "paused_reason")

    def __init__(self, limits=None):
        self.limits = limits or {}
        self.window = deque()
        self.events = deque()
        self.day = 0
        self.day_key = ""
        self.streak_fail = 0
        self.paused_reason = ""

    @property
    def per_second(self):
        try:
            return max(0.0, float(self.limits.get("per_second_limit") or 0))
        except (TypeError, ValueError):
            return 0.0

    @property
    def hourly(self):
        try:
            return max(0, int(self.limits.get("hourly_limit") or 0))
        except (TypeError, ValueError):
            return 0

    @property
    def daily(self):
        try:
            daily = int(self.limits.get("daily_limit") or 0)
        except (TypeError, ValueError):
            daily = 0
        try:
            cap = int(self.limits.get("meta_daily_cap") or 0)
        except (TypeError, ValueError):
            cap = 0
        if daily and cap:
            return min(daily, cap)
        return daily or cap


class SenderRateLimiter(object):
    def __init__(self, db=None, clock=None):
        self.db = db
        self._clock = clock or time.time
        self._lock = threading.RLock()
        self._senders = {}
        self._seeded = False
        self.auto_pause_failures = DEFAULT_AUTO_PAUSE_FAILURES

    def configure(self, sender_id, **limits):
        if not sender_id:
            return
        with self._lock:
            st = self._senders.setdefault(str(sender_id), _Sender())
            st.limits.update({k: v for k, v in limits.items() if v is not None})

    def forget(self, sender_id):
        with self._lock:
            self._senders.pop(str(sender_id), None)

    def forget_all(self):
        with self._lock:
            self._senders.clear()
            self._seeded = False

    def _state(self, sender_id):
        return self._senders.setdefault(str(sender_id), _Sender())

    def _limits_from_db(self, sender_id):
        if self.db is None:
            return {}
        getter = getattr(self.db, "get_sender_limits", None)
        if not callable(getter):
            return {}
        try:
            return getter(sender_id) or {}
        except Exception:
            return {}

    def _now(self):
        return self._clock()

    def _today_key(self, now=None):
        now = now or self._now()
        return datetime.fromtimestamp(now, BRT).strftime("%Y-%m-%d")

    def _prune(self, st, now):
        st.window = deque(t for t in st.window if now - t < 3600)
        cutoff = now - QUALITY_WINDOW
        while st.events and st.events[0][0] < cutoff:
            st.events.popleft()
        key = self._today_key(now)
        if st.day_key != key:
            st.day = 0
            st.day_key = key

    def seed(self, force=False):
        with self._lock:
            if self._seeded and not force:
                return
            self._seeded = True
            if self.db is None:
                return
            windows = getattr(self.db, "get_sender_window_counts", None)
            qualities = getattr(self.db, "get_sender_quality_counts", None)
            if not callable(windows):
                return
            now = self._now()
            today = self._today_key(now)

            def _ago(seconds):
                try:
                    return datetime.fromtimestamp(now - seconds).isoformat()
                except (OSError, OverflowError, ValueError):
                    # relogio artificial/retroativo (testes): usa o epoch
                    return datetime(1970, 1, 1).isoformat()

            hour_ago = _ago(3600)
            since = _ago(QUALITY_WINDOW)
            try:
                rows = windows(today, hour_ago) or {}
            except Exception:
                return
            try:
                qrows = qualities(since) or {} if callable(qualities) else {}
            except Exception:
                qrows = {}
            for sid, counts in rows.items():
                st = self._senders.setdefault(str(sid), _Sender())
                st.limits.update({k: v for k, v in self._limits_from_db(sid).items() if v is not None})
                st.day = int(counts.get("day") or 0)
                st.day_key = today
                n_hour = min(int(counts.get("hour") or 0), 3600)
                st.window.extend([now - i for i in range(n_hour)])
                st.window = deque(sorted(st.window))
                buckets = qrows.get(sid) or {}
                for klass, count in buckets.items():
                    count = min(int(count or 0), QUALITY_MAX_EVENTS)
                    if count:
                        st.events.extend([(now, klass)] * count)
                st.events = deque(sorted(st.events, key=lambda e: e[0]))
                st.events = deque(list(st.events)[-QUALITY_MAX_EVENTS:])

    def check(self, sender_id, now=None):
        now = now or self._now()
        with self._lock:
            st = self._state(sender_id)
            if self.db is not None:
                st.limits = self._limits_from_db(sender_id) or st.limits
            elif not st.limits:
                st.limits.update(self._limits_from_db(sender_id))
            self._prune(st, now)

            if st.paused_reason:
                return Decision(False, "pausado", used=st.streak_fail,
                                limit=self.auto_pause_failures, detail=st.paused_reason)

            per_s = st.per_second
            if per_s > 0 and st.window:
                last = st.window[-1]
                elapsed = now - last
                if elapsed < 1.0 / per_s:
                    return Decision(False, "por_segundo", used=int(per_s),
                                    limit=per_s, wait=1.0 / per_s - elapsed)

            hourly = st.hourly
            if hourly and len(st.window) >= hourly:
                oldest = st.window[0]
                return Decision(False, "por_hora", used=len(st.window), limit=hourly,
                                wait=max(0.0, oldest + 3600 - now))

            daily = st.daily
            if daily and st.day >= daily:
                return Decision(False, "por_dia", used=st.day, limit=daily)

            return Decision(True, "ok", used=len(st.window))

    def wait(self, sender_id, stop_event=None, now=None, max_wait=MAX_WAIT):
        deadline = (now or self._now()) + max_wait
        while True:
            if stop_event is not None and stop_event.is_set():
                return False
            d = self.check(sender_id, now=now)
            if d.allowed:
                return True
            if d.wait <= 0:
                return False
            slept = min(d.wait, 5.0, max(0.0, deadline - self._now()))
            if slept <= 0:
                return False
            if stop_event is not None:
                if stop_event.wait(slept):
                    return False
            else:
                time.sleep(slept)

    def record(self, sender_id, ok=True, kind=None, now=None):
        now = now or self._now()
        with self._lock:
            st = self._state(sender_id)
            if not st.limits:
                st.limits.update(self._limits_from_db(sender_id))
            self._prune(st, now)
            if ok:
                st.window.append(now)
                st.day += 1
                st.events.append((now, "delivered"))
                st.streak_fail = 0
                return
            klass = kind if kind in ("block", "reject", "soft", "config") else "soft"
            st.events.append((now, klass))
            # Pausa automatica por qualidade: so ativa se a flag global
            # quality_pause_enabled estiver ligada (default desligada ate termos
            # a API do Gupshup). Enquanto desligada, o numero nunca e travado
            # por qualidade — so o limite diario conta.
            pause_on = True
            if self.db is not None:
                getter = getattr(self.db, "get_quality_pause_enabled", None)
                if callable(getter):
                    try:
                        pause_on = bool(getter())
                    except Exception:
                        pause_on = False
            if pause_on and klass in ("block", "soft"):
                st.streak_fail += 1
                if self.auto_pause_failures and st.streak_fail >= self.auto_pause_failures:
                    st.paused_reason = (
                        "%s falha(s) seguidas - numero pausado para proteger a numeracao"
                        % st.streak_fail
                    )

    def unpause(self, sender_id):
        with self._lock:
            st = self._state(sender_id)
            st.paused_reason = ""
            st.streak_fail = 0

    def quality(self, sender_id, now=None):
        now = now or self._now()
        with self._lock:
            st = self._state(sender_id)
            # Sempre relê do banco: os limites podem ter sido alterados por
            # outra rota (ex.: /config) sem passar pelo limitador, e a tela
            # precisa mostrar o valor real, nao um cache velho.
            if self.db is not None:
                st.limits = self._limits_from_db(sender_id) or st.limits
            else:
                if not st.limits:
                    st.limits.update(self._limits_from_db(sender_id))
            self._prune(st, now)

            total = len(st.events)
            delivered = sum(1 for _, k in st.events if k == "delivered")
            blocked = sum(1 for _, k in st.events if k == "block")
            rejected = sum(1 for _, k in st.events if k == "reject")
            soft = sum(1 for _, k in st.events if k == "soft")
            failed = blocked + rejected + soft

            if st.paused_reason:
                level = "vermelho"
                score = 0.0
                label = st.paused_reason
            elif total < QUALITY_MIN_SAMPLES:
                score = None
                level = "desconhecido"
                label = "Sem mudanca registrada ainda (%d/%d envios)" % (total, QUALITY_MIN_SAMPLES)
            else:
                penalty = (blocked * 2.0 + soft * 1.0 + rejected * 0.3) / total
                score = max(0.0, min(100.0, 100.0 * (1.0 - penalty)))
                if score >= QUALITY_GREEN:
                    level = "verde"
                    label = "Alta - %d de %d entregues" % (delivered, total)
                elif score >= QUALITY_YELLOW:
                    level = "amarelo"
                    label = "Media - %d de %d entregues" % (delivered, total)
                else:
                    level = "vermelho"
                    label = "Baixa - %d de %d entregues" % (delivered, total)

            daily = st.daily
            hourly = st.hourly
            next_hour = None
            if hourly and len(st.window) >= hourly and st.window:
                next_hour = st.window[0] + 3600
            return {
                "level": level,
                "score": None if score is None else round(score),
                "label": label,
                "samples": total,
                "delivered": delivered,
                "blocked": blocked,
                "rejected": rejected,
                "failed": failed,
                "streak_fail": st.streak_fail,
                "paused": bool(st.paused_reason),
                "paused_reason": st.paused_reason,
                "second": {"used": len(st.window) and 1 or 0, "limit": st.per_second},
                "hour": {"used": len(st.window), "limit": hourly, "resets_at": next_hour},
                "day": {"used": st.day, "limit": daily},
            }

    def snapshot(self, now=None):
        now = now or self._now()
        with self._lock:
            ids = list(self._senders.keys())
        return {sid: self.quality(sid, now=now) for sid in ids}


_LIMITER = None
_LIMITER_LOCK = threading.Lock()


def get_limiter(db=None):
    global _LIMITER
    with _LIMITER_LOCK:
        if _LIMITER is None:
            _LIMITER = SenderRateLimiter(db=db)
        elif db is not None:
            _LIMITER.db = db
        return _LIMITER
