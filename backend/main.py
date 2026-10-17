from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, status, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import shutil
import os
import json
import pandas as pd
from service import DispatcherService
from auth import (
    load_users, save_users, get_password_hash, verify_password, 
    create_access_token, get_current_user, get_current_admin_user, 
    init_master_user, ACCESS_TOKEN_EXPIRE_MINUTES
)
from datetime import timedelta
import io

from database import Database
from atypical_service import AtypicalService
from leilao_service import LeilaoService, LeilaoLead

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

global_db = Database()
global_db.import_from_json()

atypical_service = AtypicalService()
leilao_service = LeilaoService(global_db)

user_services: Dict[str, DispatcherService] = {}

def get_user_service(user_email: str) -> DispatcherService:
    if user_email not in user_services:
        user_services[user_email] = DispatcherService()
    return user_services[user_email]

init_master_user()

class StartRequest(BaseModel):
    sheet_name: str
    interval_seconds: Optional[float] = None
    note_template: Optional[str] = None
    column_mapping: Dict[str, Any] = {}

class SenderUpdateData(BaseModel):
    status: str
    dialogos: List[str]
    ref_numero: Optional[str] = None
    sent_count: Optional[int] = None
    daily_limit: Optional[int] = 0

class ConfigUpdate(BaseModel):
    id_numeros: Dict[str, SenderUpdateData]

class UserCreate(BaseModel):
    email: str
    password: str
    role: str = "user"

class UserUpdatePassword(BaseModel):
    new_password: str

class Token(BaseModel):
    access_token: str
    token_type: str

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    users = load_users()
    user = users.get(form_data.username)
    if not user or not verify_password(form_data.password, user['hashed_password']):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["email"], "role": user["role"]}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me")
async def read_users_me(current_user: dict = Depends(get_current_user)):
    return {"email": current_user["email"], "role": current_user["role"]}

@app.get("/users")
async def list_users(current_user: dict = Depends(get_current_admin_user)):
    users = load_users()
    return [{"email": u["email"], "role": u["role"]} for u in users.values()]

@app.post("/users")
async def create_user(user: UserCreate, current_user: dict = Depends(get_current_admin_user)):
    users = load_users()
    if user.email in users:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    users[user.email] = {
        "email": user.email,
        "hashed_password": get_password_hash(user.password),
        "role": user.role
    }
    save_users(users)
    return {"email": user.email, "role": user.role}

@app.put("/users/{email}/password")
async def change_password(email: str, password_data: UserUpdatePassword, current_user: dict = Depends(get_current_admin_user)):
    users = load_users()
    if email not in users:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Master user can change anyone's password
    users[email]["hashed_password"] = get_password_hash(password_data.new_password)
    save_users(users)
    return {"message": "Password updated"}

# Protected Routes
@app.get("/setup/status")
def get_setup_status():
    config = global_db.get_global_config()
    if config and config.get("account_id") and config.get("token_key"):
        return {"configured": True, "company_name": config.get("company_name"), "logo_path": config.get("logo_path")}
    return {"configured": False}

@app.post("/setup")
async def setup_system(account_id: str = Form(...), token_key: str = Form(...), company_name: str = Form(...), endpoint_url: str = Form("https://s17.chatguru.app/api/v1"), logo: UploadFile = File(None)):
    logo_path = ""
    if logo:
        logo_path = os.path.join("data", f"logo_{logo.filename}")
        with open(logo_path, "wb+") as file_object:
            shutil.copyfileobj(logo.file, file_object)
    
    # Save to db
    global_db.set_global_config(account_id, token_key, company_name, logo_path, endpoint_url)
    return {"message": "Configurações salvas com sucesso"}

@app.get("/config/logo")
def get_logo():
    config = global_db.get_global_config()
    if config and config.get("logo_path") and os.path.exists(config["logo_path"]):
        from fastapi.responses import FileResponse
        return FileResponse(config["logo_path"])
    return {"message": "No logo"}

@app.get("/status")
def get_status(current_user: dict = Depends(get_current_user)):
    svc = get_user_service(current_user["email"])
    return svc.get_status()

@app.get("/live_status")
def get_live_status(current_user: dict = Depends(get_current_user)):
    return [svc.get_status() for svc in user_services.values() if getattr(svc, 'running', False) or svc.status.get("start_time")]

@app.post("/start")
def start_dispatch(req: StartRequest, current_user: dict = Depends(get_current_user)):
    try:
        svc = get_user_service(current_user["email"])
        if not svc.current_file_path:
            raise HTTPException(status_code=400, detail="Nenhum arquivo enviado")
        
        if (req.interval_seconds is not None or req.note_template is not None
                or req.column_mapping):
            global_db.set_dispatch_config(
                req.sheet_name,
                note_template=req.note_template,
                column_mapping=req.column_mapping or None,
                interval_seconds=req.interval_seconds,
            )

        if getattr(svc, 'paused', False) and svc.status.get("current_sheet") == req.sheet_name:
            svc.paused = False
            svc.stop_event.clear()
        else:
            svc.load_data(svc.current_file_path, sheet_name=req.sheet_name)
            if req.interval_seconds is not None:
                svc.dispatch_config["interval_seconds"] = req.interval_seconds
            if req.note_template is not None:
                svc.dispatch_config["note_template"] = req.note_template
            if req.column_mapping:
                svc.dispatch_config["column_mapping"] = req.column_mapping
            
        svc.start(user_email=current_user["email"])
        return {"message": f"Disparador iniciado na aba: {req.sheet_name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/stop")
def stop_dispatch(current_user: dict = Depends(get_current_user)):
    svc = get_user_service(current_user["email"])
    svc.stop()
    return {"message": "Dispatcher stopped"}


def _sheet_info(file_path, sheet_names, sample_rows=5):
    """Colunas, amostra de linhas e total de cada aba. Alimenta a UI de anotacao."""
    out = []
    for name in sheet_names:
        info = {"name": name, "columns": [], "sample": [], "total": 0}
        try:
            df = pd.read_excel(file_path, sheet_name=name)
            df.columns = [str(c).strip() for c in df.columns]
            info["columns"] = list(df.columns)
            info["total"] = int(len(df))
            head = df.head(sample_rows).fillna("")
            info["sample"] = [
                {c: ("" if pd.isna(row.get(c)) else str(row.get(c))) for c in df.columns}
                for _, row in head.iterrows()
            ]
        except Exception as e:
            info["error"] = str(e)[:200]
        out.append(info)
    return out


@app.post("/upload")
async def upload_file(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    safe_email = current_user["email"].replace("@", "_").replace(".", "_")
    file_location = os.path.join("data", f"{safe_email}_{file.filename}")
    with open(file_location, "wb+") as file_object:
        shutil.copyfileobj(file.file, file_object)
    
    try:
        xls = pd.ExcelFile(file_location)
        svc = get_user_service(current_user["email"])
        svc.current_file_path = file_location
        svc.status["completed_sheets"] = []
        sheets_info = _sheet_info(file_location, xls.sheet_names)
        return {"message": f"Arquivo {file.filename} enviado com sucesso.",
                "sheets": xls.sheet_names,
                "sheets_info": sheets_info,
                "filename": file.filename,
                "dispatch_config": global_db.get_dispatch_config(xls.sheet_names[0])
                if xls.sheet_names else {}}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/upload")
def get_upload(current_user: dict = Depends(get_current_user)):
    svc = get_user_service(current_user["email"])
    safe_email = current_user["email"].replace("@", "_").replace(".", "_")
    
    # Se o serviço subiu agora, tentamos achar o arquivo no disco
    if not svc.current_file_path:
        import glob
        pattern = os.path.join("data", f"{safe_email}_*")
        files = glob.glob(pattern)
        if files:
            # Pega o primeiro arquivo que pertencer ao usuário
            svc.current_file_path = files[0]

    if svc.current_file_path and os.path.exists(svc.current_file_path):
        try:
            xls = pd.ExcelFile(svc.current_file_path)
            safe_email_prefix = safe_email + "_"
            clean_filename = os.path.basename(svc.current_file_path).replace(safe_email_prefix, "")
            sheets_info = _sheet_info(svc.current_file_path, xls.sheet_names)
            return {"has_file": True, "filename": clean_filename,
                    "sheets": xls.sheet_names, "sheets_info": sheets_info,
                    "dispatch_config": global_db.get_dispatch_config(xls.sheet_names[0])
                    if xls.sheet_names else {}}
        except:
            pass
    return {"has_file": False}

@app.delete("/upload")
def clear_upload(current_user: dict = Depends(get_current_user)):
    svc = get_user_service(current_user["email"])
    file_path = svc.current_file_path
    svc.current_file_path = None
    svc.status["completed_sheets"] = []
    
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as e:
            print(f"Error removing file: {e}")
            
    return {"message": "Arquivo limpo"}

@app.get("/config")
def get_config(current_user: dict = Depends(get_current_user)):
    return global_db.get_senders()

@app.post("/config")
def update_config(config: ConfigUpdate, current_user: dict = Depends(get_current_user)):
    for sender_id, data in config.id_numeros.items():
        global_db.update_sender_status(sender_id, data.status)
        global_db.update_sender_daily_limit(sender_id, data.daily_limit or 0)
        existing = global_db.get_senders()["id_numeros"].get(sender_id, {})
        existing_dialogs = existing.get("dialogos", [])
        new_dialogs = data.dialogos
        
        for d in new_dialogs:
            if d not in existing_dialogs:
                global_db.add_dialog(sender_id, d)
        
        for d in existing_dialogs:
            if d not in new_dialogs:
                global_db.remove_dialog(sender_id, d)

    # Reload config in all active services so subsequent pushes grab new statuses
    for svc in user_services.values():
        svc.reload_config()
    return {"message": "Configuração atualizada"}

@app.post("/senders")
def add_sender(sender: dict, current_user: dict = Depends(get_current_user)):
    id_sender = sender.get("id")
    ref = sender.get("ref_numero")
    if not id_sender or not ref:
        raise HTTPException(status_code=400, detail="ID e Referência são obrigatórios")
    
    success = global_db.add_sender(id_sender, ref)
    if not success:
        raise HTTPException(status_code=400, detail="Remetente já existe")
    
    return {"message": "Remetente adicionado"}

@app.delete("/senders/{sender_id}")
def delete_sender(sender_id: str, current_user: dict = Depends(get_current_user)):
    global_db.delete_sender(sender_id)
    # Reload config in all active services so subsequent pushes grab new statuses
    for svc in user_services.values():
        svc.reload_config()
    return {"message": "Remetente removido com sucesso"}

@app.get("/history")
def get_history(current_user: dict = Depends(get_current_user)):
    return global_db.get_history_stats()
@app.get("/daily_failures")
def get_daily_failures(current_user: dict = Depends(get_current_user)):
    return global_db.get_daily_failures()

@app.get("/download_failures")
def download_failures(current_user: dict = Depends(get_current_user)):
    failures = global_db.get_daily_failures()
    if not failures:
        raise HTTPException(status_code=404, detail="Nenhuma falha encontrada hoje.")
    
    df = pd.DataFrame(failures)
    # Rename columns for clarity in Excel
    column_mapping = {
        'phone': 'Telefone',
        'name': 'Nome',
        'details': 'Motivo da Falha',
        'timestamp': 'Horário',
        'sender_name': 'Remetente'
    }
    df = df.rename(columns=column_mapping)
    # Reorder columns
    cols = ['Horário', 'Nome', 'Telefone', 'Motivo da Falha', 'Remetente']
    df = df[cols]
    
    file_path = os.path.join("data", "falhas_do_dia.xlsx")
    df.to_excel(file_path, index=False)
    
    return FileResponse(
        path=file_path,
        filename=f"falhas_{pd.Timestamp.now().strftime('%Y-%m-%d')}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


# ═══════════════════════════════════════════════════════════════
# ══  ROTAS DO DISPARADOR ATÍPICO  ═════════════════════════════
# ═══════════════════════════════════════════════════════════════

# --- Templates ---

class AtypicalTemplateCreate(BaseModel):
    sender_id: str
    dialog_id: str
    label: Optional[str] = ""

class AtypicalTemplateUpdate(BaseModel):
    dialog_id: Optional[str] = None
    label: Optional[str] = None
    status: Optional[str] = None

@app.get("/atypical/templates")
def get_atypical_templates(current_user: dict = Depends(get_current_user)):
    return global_db.get_atypical_templates()

@app.post("/atypical/templates")
def add_atypical_template(data: AtypicalTemplateCreate, current_user: dict = Depends(get_current_user)):
    new_id = global_db.add_atypical_template(data.sender_id, data.dialog_id, data.label or "")
    return {"id": new_id, "message": "Template adicionado"}

@app.put("/atypical/templates/{template_id}")
def update_atypical_template(template_id: int, data: AtypicalTemplateUpdate, current_user: dict = Depends(get_current_user)):
    global_db.update_atypical_template(template_id, data.dialog_id, data.label, data.status)
    return {"message": "Template atualizado"}

@app.delete("/atypical/templates/{template_id}")
def delete_atypical_template(template_id: int, current_user: dict = Depends(get_current_user)):
    global_db.delete_atypical_template(template_id)
    return {"message": "Template removido"}

# --- Upload Atípico ---

@app.post("/atypical/upload")
async def upload_atypical_file(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    safe_email = current_user["email"].replace("@", "_").replace(".", "_")
    file_location = os.path.join("data", f"atypical_{safe_email}_{file.filename}")
    with open(file_location, "wb+") as file_object:
        shutil.copyfileobj(file.file, file_object)

    try:
        df = pd.read_excel(file_location)
        df.columns = df.columns.str.strip()
        columns = df.columns.tolist()
        
        # Pegar amostra das primeiras linhas para preview
        sample = df.head(3).to_dict('records')
        # Converter NaN para None para JSON
        for row in sample:
            for k, v in row.items():
                if pd.isna(v):
                    row[k] = None

        return {
            "message": f"Arquivo {file.filename} enviado.",
            "file_path": file_location,
            "filename": file.filename,
            "columns": columns,
            "total_rows": len(df),
            "sample": sample
        }
    except Exception as e:
        if os.path.exists(file_location):
            os.remove(file_location)
        raise HTTPException(status_code=400, detail=str(e))

# --- Tarefas Atípicas ---

class AtypicalTaskCreate(BaseModel):
    file_path: str
    phone_column: str
    phone_column_fallback: Optional[str] = None
    name_column: str
    note_template: str = ""
    column_mapping: Dict[str, Any] = {}
    scheduled_at: Optional[str] = None  # ISO format ou null para executar agora
    total: int = 0

# ── Leilão (Esteira) ────────────────────────────────────────────────────────
class LeilaoStateUpdate(BaseModel):
    paused: Optional[bool] = None
    interval_seconds: Optional[float] = None
    note_template: Optional[str] = None

class LeilaoDialogAdd(BaseModel):
    sender_id: str
    dialog_id: str

@app.post("/atypical/tasks")
def create_atypical_task(data: AtypicalTaskCreate, current_user: dict = Depends(get_current_user)):
    task_id = global_db.create_atypical_task(
        file_path=data.file_path,
        phone_column=data.phone_column,
        name_column=data.name_column,
        note_template=data.note_template,
        column_mapping=data.column_mapping,
        total=data.total,
        phone_column_fallback=data.phone_column_fallback,
        scheduled_at=data.scheduled_at,
        created_by=current_user["email"]
    )
    
    # Se não tem agendamento, iniciar imediatamente
    if not data.scheduled_at:
        atypical_service.start_task(task_id)
    
    return {"task_id": task_id, "message": "Tarefa criada"}

@app.get("/atypical/tasks")
def get_atypical_tasks(current_user: dict = Depends(get_current_user)):
    return global_db.get_atypical_tasks()

@app.get("/atypical/tasks/{task_id}")
def get_atypical_task_status(task_id: int, current_user: dict = Depends(get_current_user)):
    task = global_db.get_atypical_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    return task

@app.post("/atypical/tasks/{task_id}/pause")
def pause_atypical_task(task_id: int, current_user: dict = Depends(get_current_user)):
    task = global_db.get_atypical_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    atypical_service.pause_task(task_id)
    return {"message": "Tarefa pausada"}

@app.post("/atypical/tasks/{task_id}/resume")
def resume_atypical_task(task_id: int, current_user: dict = Depends(get_current_user)):
    task = global_db.get_atypical_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    atypical_service.resume_task(task_id)
    return {"message": "Tarefa retomada"}

@app.delete("/atypical/tasks/{task_id}")
def cancel_atypical_task(task_id: int, current_user: dict = Depends(get_current_user)):
    atypical_service.cancel_task(task_id)
    return {"message": "Tarefa cancelada"}

# --- Remetentes disponíveis para atípico (herda do principal) ---

@app.get("/atypical/senders")
def get_atypical_senders(current_user: dict = Depends(get_current_user)):
    """Retorna os remetentes do sistema principal para seleção nos templates atípicos"""
    return global_db.get_senders()


# ── Leilão (Esteira) ────────────────────────────────────────────────────────

@app.post("/webhook/leilao")
def webhook_leilao(lead: LeilaoLead):
    """Webhook do sistema externo (Leilão Ao Vivo). Sem auth — idempotente por lead_id."""
    return leilao_service.receive_lead(lead.model_dump())


@app.get("/leilao/state")
def get_leilao_state(current_user: dict = Depends(get_current_user)):
    st = global_db.get_leilao_state()
    return {
        "paused": bool(st.get("paused")),
        "interval_seconds": st.get("interval_seconds", 1.0),
        "note_template": st.get("note_template", ""),
        "dialogs": global_db.get_leilao_dialogs(),
        "webhook_url": "/api/webhook/leilao",
    }


@app.post("/leilao/state")
def update_leilao_state(data: LeilaoStateUpdate, current_user: dict = Depends(get_current_user)):
    global_db.set_leilao_state(paused=data.paused, interval_seconds=data.interval_seconds,
                               note_template=data.note_template)
    if data.paused is False:
        leilao_service.resume()
    elif data.paused is True:
        leilao_service.pause()
    return {"message": "Estado atualizado"}


@app.post("/leilao/resume")
def resume_leilao(current_user: dict = Depends(get_current_user)):
    leilao_service.resume()
    return {"message": "Retomado"}


@app.get("/leilao/log")
def get_leilao_log(current_user: dict = Depends(get_current_user)):
    return global_db.get_leilao_log(limit=200)


@app.get("/leilao/dialogs")
def get_leilao_dialogs(current_user: dict = Depends(get_current_user)):
    return {"dialogs": global_db.get_leilao_dialogs()}


@app.post("/leilao/dialogs")
def add_leilao_dialog(data: LeilaoDialogAdd, current_user: dict = Depends(get_current_user)):
    ok = global_db.add_leilao_dialog(data.sender_id, data.dialog_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Já existe esse par (número, diálogo)")
    return {"message": "Adicionado"}


@app.delete("/leilao/dialogs/{row_id}")
def remove_leilao_dialog(row_id: int, current_user: dict = Depends(get_current_user)):
    global_db.remove_leilao_dialog(row_id)
    return {"message": "Removido"}

# ── Limitadores por número ──
class SenderLimitsUpdate(BaseModel):
    limits: Dict[str, Dict[str, Any]]

class SenderUnpause(BaseModel):
    sender_id: str

@app.post("/senders/limits")
def save_sender_limits(data: SenderLimitsUpdate, current_user: dict = Depends(get_current_user)):
    from rate_limit import get_limiter
    limiter = get_limiter(global_db)
    saved = {}
    for sender_id, patch in (data.limits or {}).items():
        clean = {}
        for field, cast in (("per_second", float), ("hourly", int), ("daily", int),
                            ("meta_daily_cap", int), ("auto_pause_failures", int)):
            if field not in (patch or {}):
                continue
            try:
                value = cast(patch.get(field) or 0)
            except (TypeError, ValueError):
                value = 0
            clean[field] = max(0, value) if field != "per_second" else max(0.0, value)
        if not clean:
            continue
        global_db.update_sender_status(sender_id, (global_db.get_senders()["id_numeros"].get(sender_id) or {}).get("status", "ativado"))
        global_db.update_sender_daily_limit(sender_id, clean.get("daily", 0))
        db_patch = {
            "hourly_limit": clean.get("hourly", 0),
            "per_second_limit": clean.get("per_second", 0),
            "meta_daily_cap": clean.get("meta_daily_cap", 0),
            "auto_pause_failures": clean.get("auto_pause_failures", 5) or 5,
        }
        global_db.update_sender_vendeai if hasattr(global_db, "update_sender_vendeai") else None
        # chatguru db has no update_sender_vendeai; patch columns directly
        with global_db.lock:
            conn = global_db._get_conn()
            cursor = conn.cursor()
            cols = ", ".join(f"{k} = ?" for k in db_patch)
            cursor.execute(f"UPDATE senders SET {cols} WHERE id = ?", tuple(db_patch[k] for k in db_patch) + (sender_id,))
            conn.commit()
            conn.close()
        limiter.configure(sender_id, per_second_limit=clean.get("per_second", 0),
                          hourly_limit=clean.get("hourly", 0), daily_limit=clean.get("daily", 0),
                          meta_daily_cap=clean.get("meta_daily_cap", 0))
        saved[sender_id] = clean
    return {"ok": True, "saved": saved}

@app.post("/senders/unpause")
def unpause_sender(data: SenderUnpause, current_user: dict = Depends(get_current_user)):
    from rate_limit import get_limiter
    get_limiter(global_db).unpause(data.sender_id)
    return {"ok": True}

@app.get("/senders/quality")
def senders_quality(current_user: dict = Depends(get_current_user)):
    from rate_limit import get_limiter
    limiter = get_limiter(global_db)
    limiter.seed()
    senders = global_db.get_senders().get("id_numeros", {})
    out = {}
    for sid, info in senders.items():
        lim = global_db.get_sender_limits(sid)
        out[sid] = {
            "ref_numero": info.get("ref_numero"),
            "quality": limiter.quality(sid),
            "usage": {"second": limiter.quality(sid)["second"],
                      "hour": limiter.quality(sid)["hour"],
                      "day": limiter.quality(sid)["day"]},
            "limits": lim,
        }
    return {"senders": out}

@app.get("/diagnostico")
def diagnostico(current_user: dict = Depends(get_current_user)):
    checks = []

    def add(nome, estado, detalhe):
        checks.append({"nome": nome, "estado": estado, "detalhe": detalhe})

    try:
        senders = global_db.get_senders().get("id_numeros", {})
        add("Banco de dados", "ok", f"{len(senders)} número(s) cadastrado(s)")
    except Exception as e:
        add("Banco de dados", "erro", str(e))
        return {"checks": checks, "resumo": {"ok": 0, "aviso": 0, "erro": 1},
                "pronto_para_disparar": False, "numeros_pausados": []}

    cfg = global_db.get_global_config() or {}
    if cfg.get("account_id") and cfg.get("token_key"):
        add("Credenciais ChatGuru", "ok", "account_id e token_key cadastrados")
    else:
        add("Credenciais ChatGuru", "erro", "falta account_id ou token_key — va em Configurações")

    senders_ativos = [s for s in senders.values() if s.get("status") == "ativado"]
    com_dialogo = [s for s in senders_ativos if s.get("dialogos")]
    if not com_dialogo:
        add("Números com diálogo", "erro", "nenhum número tem diálogo configurado")
    else:
        add("Números com diálogo", "ok", f"{len(com_dialogo)} de {len(senders_ativos)} número(s)")

    # leilão
    pairs = global_db.get_leilao_dialogs()
    if pairs:
        add("Leilão configurado", "ok", f"{len(pairs)} par(es) número→diálogo")
    else:
        add("Leilão configurado", "aviso", "nenhum par configurado — webhook do leilão não vai disparar")

    # limites
    from rate_limit import get_limiter
    limiter = get_limiter(global_db)
    limiter.seed()
    com_limite = 0
    for s in senders_ativos:
        lim = global_db.get_sender_limits(s and list(senders.keys())[list(senders.values()).index(s)])
        if (lim.get("hourly_limit") or lim.get("daily_limit")
                or lim.get("per_second_limit") or lim.get("meta_daily_cap")):
            com_limite += 1
    if senders_ativos and com_limite == 0:
        add("Limitadores", "aviso", "nenhum número tem teto por hora/dia — risco de ban alto")
    elif com_limite:
        add("Limitadores", "ok", f"{com_limite} número(s) com teto")

    # qualidade
    pausados = [sid for sid, s in senders.items()
                if limiter.quality(sid).get("paused")]
    if senders_ativos and len(pausados) >= len(senders_ativos):
        add("Qualidade dos números", "erro", "TODOS os números pausados — reative em Configurações")
    elif pausados:
        add("Qualidade dos números", "aviso", "pausados: " + ", ".join(pausados))
    else:
        add("Qualidade dos números", "ok", "nenhum número pausado")

    # dedup
    cfg = global_db.get_global_config() or {}
    add("Dedup", "ok", f"ignora reenvio nos últimos {cfg.get('dedup_days', 7)} dia(s)")

    # último disparo
    st = None
    for svc in user_services.values():
        st = svc.get_status()
        break
    if st and st.get("total"):
        add("Último disparo", "ok",
            f"{st.get('current_sheet')}: {st.get('success')} ok, {st.get('failed')} falha(s), "
            f"{st.get('skipped')} pulado(s)")

    resumo = {"ok": sum(1 for c in checks if c["estado"] == "ok"),
              "aviso": sum(1 for c in checks if c["estado"] == "aviso"),
              "erro": sum(1 for c in checks if c["estado"] == "erro")}
    return {"checks": checks, "resumo": resumo,
            "pronto_para_disparar": resumo["erro"] == 0,
            "numeros_pausados": pausados}


class DispatchConfigUpdate(BaseModel):
    sheet_name: str
    note_template: Optional[str] = None
    column_mapping: Dict[str, Any] = {}
    interval_seconds: Optional[float] = None


@app.post("/dispatch/config")
def save_dispatch_config(data: DispatchConfigUpdate, current_user: dict = Depends(get_current_user)):
    global_db.set_dispatch_config(
        data.sheet_name,
        note_template=data.note_template,
        column_mapping=data.column_mapping or None,
        interval_seconds=data.interval_seconds,
    )
    return {"ok": True, "config": global_db.get_dispatch_config(data.sheet_name)}


@app.get("/dispatch/config")
def get_dispatch_config_route(sheet_name: str = "", current_user: dict = Depends(get_current_user)):
    return global_db.get_dispatch_config(sheet_name)


@app.get("/dispatch/preview")
def dispatch_preview(sheet_name: str = "", current_user: dict = Depends(get_current_user)):
    svc = get_user_service(current_user["email"])
    if not svc.current_file_path:
        raise HTTPException(status_code=400, detail="Nenhuma planilha carregada")
    cfg = global_db.get_dispatch_config(sheet_name) or {}
    try:
        df = pd.read_excel(svc.current_file_path, sheet_name=sheet_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Não consegui ler a aba: {e}")
    df.columns = df.columns.str.strip()
    rows = df.to_dict("records")
    note_template = cfg.get("note_template") or ""
    column_mapping = cfg.get("column_mapping") or {}
    from notes import build_note_text
    out = []
    for idx, row in enumerate(rows[:5]):
        numero = str(row.get("numero") or row.get("Numero") or "").strip()
        nome = str(row.get("nome") or row.get("Nome") or "").strip()
        fmt = svc.formatar_numero_completo(numero)
        note = build_note_text(note_template, row, column_mapping) if note_template else None
        out.append({
            "linha": idx + 2,
            "numero_bruto": numero,
            "nome": nome,
            "formatado": fmt,
            "dedup_hoje": svc.db.is_already_sent_today(numero) if numero else False,
            "anotacao": note,
        })
    return {"aba": sheet_name, "total_linhas": len(rows),
            "colunas": list(df.columns), "linhas": out,
            "note_template": note_template, "column_mapping": column_mapping}
