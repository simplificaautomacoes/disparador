"""Cliente do ChatGuru: extrai as chamadas HTTP para um lugar só.

Antes essas funções moravam dentro de service.py (e eram copiadas em
atypical_service.py). Extrair evita duplicação e permite que o leilão (e o
diagnóstico) usem o mesmo caminho sem reimplementar o cadastro assíncrono.
"""
import requests
import time
from datetime import datetime, timezone, timedelta

BRT = timezone(timedelta(hours=-3))


def _make_request(endpoint_url, parametros, max_retries=3):
    delay = 2
    for attempt in range(max_retries):
        try:
            res = requests.post(endpoint_url, data=parametros, timeout=15)
            if res.status_code == 429:
                print(f"Rate limit API ChatGuru (429). Aguardando {delay}s na tentativa {attempt + 1}...")
                time.sleep(delay)
                delay *= 2
                continue
            try:
                return dict(res.json())
            except Exception:
                return {}
        except requests.exceptions.RequestException as e:
            print(f"Falha de conexão com a API (Tentativa {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                time.sleep(delay)
                delay *= 2
            else:
                print("Esgotadas as tentativas de requisição.")
                return {}
    return {}


def formatar_numero_completo(telefone):
    # Always return a tuple of two strings (numero_12_digitos, numero_13_digitos)
    # numero_12_digitos: 55 + 2 DDD + 8 digitos (ex: 553199999999) - Ideal para dialog_execute
    # numero_13_digitos: 55 + 2 DDD + 9 digitos (ex: 5531999999999) - Ideal para chat_add
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


def cadastrar_chat(cred, numero_formatado, nome, phone_id, dialog_id=None):
    nome_str = str(nome).strip()
    nome_safe = nome_str if nome_str and nome_str.lower() != "nan" else f"Novo Contato {numero_formatado}"
    parametros = {
        "key": cred["token_key"],
        "account_id": cred["account_id"],
        "phone_id": phone_id,
        "action": "chat_add",
        "name": nome_safe,
        "chat_number": numero_formatado,
        "text": " ",
    }
    if dialog_id:
        parametros["dialog_id"] = dialog_id
    endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
    return _make_request(endpoint_url, parametros)


def verificar_status_cadastro(cred, chat_add_id, phone_id, chat_number):
    parametros = {
        "key": cred["token_key"],
        "account_id": cred["account_id"],
        "phone_id": phone_id,
        "action": "chat_add_status",
        "chat_add_id": chat_add_id,
        "chat_number": chat_number,
    }
    endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
    return _make_request(endpoint_url, parametros)


def enviar_dialogo(cred, numero_formatado, dialogo, phone_id):
    parametros = {
        "key": cred["token_key"],
        "account_id": cred["account_id"],
        "phone_id": phone_id,
        "action": "dialog_execute",
        "chat_number": numero_formatado,
        "dialog_id": dialogo,
    }
    endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
    return _make_request(endpoint_url, parametros)


def adicionar_anotacao(cred, numero, note_text, phone_id):
    parametros = {
        "key": cred["token_key"],
        "account_id": cred["account_id"],
        "phone_id": phone_id,
        "action": "note_add",
        "chat_number": numero,
        "note_text": note_text,
    }
    endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
    return _make_request(endpoint_url, parametros)


def chat_update_context(cred, phone_id, chat_number, context):
    """Var__nome=value para alimentar o diálogo."""
    parametros = {
        "key": cred["token_key"],
        "account_id": cred["account_id"],
        "phone_id": phone_id,
        "action": "chat_update_context",
        "chat_number": chat_number,
    }
    for k, v in (context or {}).items():
        parametros["var__%s" % k] = v
    endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
    return _make_request(endpoint_url, parametros)


def enviar_mensagem(cred, phone_id, chat_number, text, send_date=None):
    parametros = {
        "key": cred["token_key"],
        "account_id": cred["account_id"],
        "phone_id": phone_id,
        "action": "message_send",
        "text": text,
        "chat_number": chat_number,
    }
    if send_date:
        parametros["send_date"] = send_date
    endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
    return _make_request(endpoint_url, parametros)


def verificar_status_mensagem(cred, message_id, phone_id):
    parametros = {
        "key": cred["token_key"],
        "account_id": cred["account_id"],
        "phone_id": phone_id,
        "action": "message_status",
        "message_id": message_id,
    }
    endpoint_url = cred.get("endpoint_url", "https://s17.chatguru.app/api/v1")
    return _make_request(endpoint_url, parametros)
