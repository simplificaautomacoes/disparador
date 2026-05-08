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

user_services: Dict[str, DispatcherService] = {}

def get_user_service(user_email: str) -> DispatcherService:
    if user_email not in user_services:
        user_services[user_email] = DispatcherService()
    return user_services[user_email]

init_master_user()

class StartRequest(BaseModel):
    sheet_name: str

class SenderUpdateData(BaseModel):
    status: str
    dialogos: List[str]
    ref_numero: Optional[str] = None
    sent_count: Optional[int] = None

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
        
        # Resume if paused and the sheet matches
        if getattr(svc, 'paused', False) and svc.status.get("current_sheet") == req.sheet_name:
            svc.paused = False
        else:
            svc.load_data(svc.current_file_path, sheet_name=req.sheet_name)
            
        svc.start(user_email=current_user["email"])
        return {"message": f"Disparador iniciado na aba: {req.sheet_name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/stop")
def stop_dispatch(current_user: dict = Depends(get_current_user)):
    svc = get_user_service(current_user["email"])
    svc.stop()
    return {"message": "Dispatcher stopped"}

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
        return {"message": f"Arquivo {file.filename} enviado com sucesso.", "sheets": xls.sheet_names, "filename": file.filename}
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
            return {"has_file": True, "filename": clean_filename, "sheets": xls.sheet_names}
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
    
    file_path = os.path.join(DATA_DIR, "falhas_do_dia.xlsx")
    df.to_excel(file_path, index=False)
    
    return FileResponse(
        path=file_path,
        filename=f"falhas_{pd.Timestamp.now().strftime('%Y-%m-%d')}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
