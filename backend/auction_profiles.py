"""Configuração independente por leilão; o padrão continua usando as tabelas legadas."""
import json
import math
import re

DEFAULT_VARS = ["lead_id", "cpf", "nome", "primeiro_nome", "matricula", "valor_num",
                "prazo_desejado_parcelas", "origem", "tempo_vinculo_meses",
                "margem_disponivel", "celulares", "qualifica", "cnpj_empregador",
                "nome_empresa", "tipo_empregador", "cnaes_empregador"]
ODYSSEIA_VARS = ["delivery_id", "external_id", "email", "valor_liberado", "parcelas",
                "data_nascimento", "data_admissao", "validade", "capturado_em",
                "banco_aprovado", "telefones", "whatsapps", "cnpj_empresa"]


def profile_for(lead):
    return str(lead.get("leilao_id") or (
        "odysseia" if str(lead.get("origem") or "").lower() == "odysseia" else "padrao"))


def lead_view(raw):
    view = {key: "" for key in DEFAULT_VARS + ODYSSEIA_VARS}
    def flatten(value, prefix=""):
        for key, item in (value or {}).items():
            key = prefix + str(key)
            if isinstance(item, dict):
                flatten(item, key + ".")
            elif isinstance(item, list):
                view[key] = "; ".join(str(v) for v in item)
            else:
                view[key] = "" if item is None else str(item)
    flatten(raw)
    name = str((raw or {}).get("nome") or "").split()
    view["primeiro_nome"] = name[0] if name else ""
    return view


def render_lead(template, raw):
    if not template or not template.strip():
        return None
    view = lead_view(raw or {})
    return re.sub(r"(?<!\{)\{([\w.]+)\}(?!\})", lambda match: view.get(match[1], ""), template)


class AuctionProfiles:
    def __init__(self, db, provider="guru"):
        self.db = db
        self.provider = provider
        with db.lock:
            conn = db._get_conn()
            try:
                conn.execute("CREATE TABLE IF NOT EXISTS auction_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL)")
                for key, name in [("padrao", "Leilão padrão"), ("odysseia", "Leilão Odysseia")]:
                    conn.execute("INSERT OR IGNORE INTO auction_profiles VALUES (?, ?, '{}')", (key, name))
                conn.commit()
            finally:
                conn.close()

    def list(self):
        with self.db.lock:
            conn = self.db._get_conn()
            rows = conn.execute("SELECT id, name FROM auction_profiles ORDER BY CASE id WHEN 'padrao' THEN 0 WHEN 'odysseia' THEN 1 ELSE 2 END, name").fetchall()
            conn.close()
        return [{"id": row[0], "name": row[1]} for row in rows]

    def state(self, key="padrao"):
        with self.db.lock:
            conn = self.db._get_conn()
            row = conn.execute("SELECT name, config_json FROM auction_profiles WHERE id = ?", (key,)).fetchone()
            conn.close()
        if not row:
            raise ValueError("Leilão não encontrado")
        config = json.loads(row[1])
        state = {"paused": False, "interval_seconds": 1, "note_template": "", "message_template": "", "parameter_mapping": {}}
        if key == "padrao":
            state.update(self.db.get_leilao_state())
        state.update(config)
        return dict(state, id=key, name=row[0], available_vars=DEFAULT_VARS + ODYSSEIA_VARS,
                    webhook_url="/api/webhook/leilao" + ("/" + key if key != "padrao" else ""))

    def create(self, key, name):
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,49}", key) or not name.strip():
            raise ValueError("Use um identificador com letras minúsculas, números, hífen ou sublinhado e informe o nome")
        with self.db.lock:
            conn = self.db._get_conn()
            try:
                conn.execute("INSERT INTO auction_profiles VALUES (?, ?, '{}')", (key, name.strip()[:100]))
                conn.commit()
            finally:
                conn.close()
        return self.state(key)

    def update(self, key, **patch):
        self.state(key)  # valida a existência antes de qualquer alteração
        patch = {k: v for k, v in patch.items() if v is not None and k in (
            "paused", "interval_seconds", "note_template", "message_template", "parameter_mapping")}
        if "interval_seconds" in patch:
            value = float(patch["interval_seconds"])
            if not math.isfinite(value) or value < 0:
                raise ValueError("Intervalo deve ser um número finito maior ou igual a zero")
        if "parameter_mapping" in patch:
            mapping = patch["parameter_mapping"]
            if not isinstance(mapping, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in mapping.items()):
                raise ValueError("Mapeamento de variáveis inválido")
        legacy_keys = {"paused", "interval_seconds", "note_template" if self.provider == "guru" else "message_template"}
        if key == "padrao":
            legacy = {k: v for k, v in patch.items() if k in legacy_keys}
            if self.provider != "guru" and "interval_seconds" in legacy:
                legacy["interval"] = legacy.pop("interval_seconds")
            if legacy:
                self.db.set_leilao_state(**legacy)
            patch = {k: v for k, v in patch.items() if k not in legacy_keys}
        if patch:
            with self.db.lock:
                conn = self.db._get_conn()
                try:
                    old = json.loads(conn.execute("SELECT config_json FROM auction_profiles WHERE id = ?", (key,)).fetchone()[0])
                    old.update(patch)
                    conn.execute("UPDATE auction_profiles SET config_json = ? WHERE id = ?", (json.dumps(old, ensure_ascii=False), key))
                    conn.commit()
                finally:
                    conn.close()
        return self.state(key)
