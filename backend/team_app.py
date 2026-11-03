"""Self-hosted team API. Run behind HTTPS; SQLite data belongs on a persistent volume."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, Depends, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError, model_validator
from backend.knowledge import TraceReport
from backend.app import CompareRequest, Analysis, Finding, Snapshot, Box, decode_image
from backend.local_engine import analyze, ENGINE
import asyncio

app = FastAPI(title='project-1 Team Workspace')
origins = [value.strip() for value in os.getenv('TEAM_ORIGINS','').split(',') if value.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['GET','POST','PUT','DELETE'], allow_headers=['Authorization','Content-Type'])
limit = asyncio.Semaphore(1)

@contextmanager
def db():
    path = Path(os.getenv('TEAM_DB','data/team.sqlite3'))
    path.parent.mkdir(parents=True,exist_ok=True)
    con = sqlite3.connect(path,timeout=15)
    con.row_factory = sqlite3.Row
    con.executescript('''
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members(team_id TEXT,user_id TEXT,role TEXT,PRIMARY KEY(team_id,user_id));
    CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY,team_id TEXT,email TEXT,expires REAL);
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,team_id TEXT,payload TEXT,revision INTEGER,updated REAL,author TEXT);
    CREATE TABLE IF NOT EXISTS issue_reports(team_id TEXT,id TEXT,payload TEXT,revision INTEGER,updated REAL,author TEXT,PRIMARY KEY(team_id,id));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,team_id TEXT,review_id TEXT,user_id TEXT,action TEXT,created REAL);
    ''')
    try:
        yield con
        con.commit()
    finally:
        con.close()

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def password_hash(password,salt=None):
    salt = salt or secrets.token_hex(16)
    result = hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1,maxmem=64*1024*1024).hex()
    return salt+':'+result

class Credentials(BaseModel):
    email: str = Field(min_length=3,max_length=254,pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    password: str = Field(min_length=12,max_length=256)
    invite: str = Field(default='',max_length=256)
    bootstrap: str = Field(default='',max_length=256)

class TeamName(BaseModel):
    name: str = Field(min_length=1,max_length=120)

class Invite(BaseModel):
    email: str = Field(min_length=3,max_length=254,pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')

class ReviewInput(BaseModel):
    payload: dict
    revision: int = Field(default=0,ge=0)

class ReviewState(BaseModel):
    status: Literal['open','accepted','fixed']
    owner: str = Field(default='',max_length=120)
    impact: str = Field(default='',max_length=500)
    comment: str = Field(default='',max_length=2000)
    updatedAt: str = Field(default='',max_length=100)

class Approval(BaseModel):
    status: Literal['draft','changes-requested','approved']
    reviewer: str = Field(default='',max_length=120)
    note: str = Field(default='',max_length=2000)
    updatedAt: str = Field(default='',max_length=100)

class SavedFinding(Finding):
    id: str = Field(min_length=1,max_length=100)
    dismissed: bool = False
    review: ReviewState | None = None

class SavedDesign(BaseModel):
    image: str = Field(max_length=12_000_000)
    name: str = Field(max_length=1000)
    width: int = Field(gt=0,le=12000)
    height: int = Field(gt=0,le=12000)

class CaptureQuality(BaseModel):
    ready: bool
    pendingImages: int = Field(ge=0)
    brokenImages: int = Field(ge=0)
    fontsReady: bool
    layoutStable: bool
    warnings: list[str] = Field(max_length=20)

class SavedSnapshot(Snapshot):
    quality: CaptureQuality | None = None

class SavedCapture(BaseModel):
    image: str = Field(max_length=12_000_000)
    snapshot: SavedSnapshot
    capturedAt: str = Field(max_length=100)

class Alignment(BaseModel):
    x: float = Field(ge=-2000,le=2000,allow_inf_nan=False)
    y: float = Field(ge=-2000,le=2000,allow_inf_nan=False)
    scale: float = Field(ge=.5,le=2,allow_inf_nan=False)

class SavedOptions(BaseModel):
    tolerancePx: int = Field(default=8,ge=0,le=16)
    normalization: Literal['fit','strict'] = 'fit'
    alignment: Alignment | None = None

class Verification(BaseModel):
    previousIssue: str = Field(max_length=150)
    outcome: Literal['still-detected','not-detected']
    currentIssueId: str | None = Field(default=None,max_length=100)

class SavedDiff(BaseModel):
    changedPercent: float = Field(ge=0,le=100,allow_inf_nan=False)
    regions: list[Box] = Field(max_length=60)

class SavedRecord(Analysis):
    id: str = Field(min_length=1,max_length=100)
    createdAt: str = Field(max_length=100)
    design: SavedDesign
    sourceDesign: SavedDesign | None = None
    capture: SavedCapture
    issues: list[SavedFinding] = Field(max_length=40)
    model: str = Field(max_length=100)
    diff: SavedDiff
    options: SavedOptions | None = None
    baselineId: str | None = Field(default=None,max_length=100)
    pinned: bool = False
    verification: list[Verification] | None = Field(default=None,max_length=40)
    approval: Approval | None = None
    knowledge: TraceReport | None = None

    @model_validator(mode='after')
    def trace_matches_capture(self):
        if self.knowledge:
            trace=self.knowledge
            if trace.comparisonId!=self.id or trace.capture.page!=self.capture.snapshot.url or trace.capture.capturedAt!=self.capture.capturedAt or trace.capture.width!=self.capture.snapshot.width or trace.capture.height!=self.capture.snapshot.height:
                raise ValueError('Knowledge trace must belong to this comparison and capture.')
            reference=self.sourceDesign or self.design
            try:
                fingerprint=hashlib.sha256(base64.b64decode(reference.image.split(',',1)[1],validate=True)).hexdigest()
            except Exception as exc: raise ValueError('Invalid trace reference image.') from exc
            if fingerprint!=trace.referenceHash: raise ValueError('Knowledge trace reference changed. Re-evaluate the comparison.')
        return self


@app.middleware('http')
async def controls(request: Request,call_next):
    if request.method in ('POST','PUT'):
        body=bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body)>32_000_000:
                return Response('Request exceeds 32 MB',status_code=413)
        request._body=bytes(body)
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Cache-Control']='no-store'
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:8765 https:; worker-src 'self' blob:; frame-ancestors 'none'"
    return response

async def user(authorization: str = Header(default='')):
    if not authorization.startswith('Bearer '): raise HTTPException(401,'Sign in to your team workspace.')
    with db() as con:
        row=con.execute('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>?',(digest(authorization[7:]),time.time())).fetchone()
    if not row: raise HTTPException(401,'Session expired. Sign in again.')
    return dict(row)

def member(con,team_id,user_id,owner=False):
    row=con.execute('SELECT role FROM members WHERE team_id=? AND user_id=?',(team_id,user_id)).fetchone()
    if not row or owner and row['role']!='owner': raise HTTPException(403,'Workspace access denied.')

# Small in-process guard; production proxy must also rate-limit authentication.
failed={}
def auth_limit(request,email):
    key=((request.client.host if request.client else 'unknown'),digest(email.strip().lower()))
    now=time.time()
    if len(failed)>10000:
        for stale in list(failed):
            if not failed[stale] or now-failed[stale][-1]>900: failed.pop(stale,None)
        if len(failed)>10000: raise HTTPException(429,'Authentication is busy. Try again later.')
    failed[key]=[t for t in failed.get(key,[]) if now-t<900]
    if len(failed[key])>=10: raise HTTPException(429,'Too many authentication attempts. Try again in 15 minutes.')
    failed[key].append(now)

@app.post('/auth/register')
def register(body:Credentials,request:Request):
    auth_limit(request,body.email)
    email=body.email.strip().lower()
    with db() as con:
        # Serialize first-account bootstrap and single-use invite consumption.
        con.execute('BEGIN IMMEDIATE')
        first=con.execute('SELECT 1 FROM users LIMIT 1').fetchone() is None
        invitation=None
        if first:
            expected=os.getenv('TEAM_BOOTSTRAP_KEY','')
            if len(expected)<32 or expected=='replace-with-a-long-random-secret' or not hmac.compare_digest(body.bootstrap,expected): raise HTTPException(403,'A server bootstrap key is required for the first account.')
        else:
            invitation=con.execute('SELECT * FROM invites WHERE code=? AND email=? AND expires>?',(digest(body.invite),email,time.time())).fetchone()
            if not invitation: raise HTTPException(403,'A valid invitation for this email is required.')
        uid=secrets.token_hex(16)
        try: con.execute('INSERT INTO users VALUES(?,?,?)',(uid,email,password_hash(body.password)))
        except sqlite3.IntegrityError: raise HTTPException(409,'Account could not be registered. Try signing in.')
        if invitation:
            con.execute('INSERT INTO members VALUES(?,?,?)',(invitation['team_id'],uid,'member'))
            con.execute('DELETE FROM invites WHERE code=?',(invitation['code'],))
    return {'ok':True}

@app.post('/auth/login')
def login(body:Credentials,request:Request):
    auth_limit(request,body.email)
    with db() as con:
        row=con.execute('SELECT * FROM users WHERE email=?',(body.email.strip().lower(),)).fetchone()
        stored=row['password'] if row else password_hash('dummy-password-value')
        if not row or not hmac.compare_digest(password_hash(body.password,stored.split(':')[0]),stored): raise HTTPException(401,'Email or password is incorrect.')
        token=secrets.token_urlsafe(32)
        con.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
        con.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(token),row['id'],time.time()+12*3600))
    return {'token':token,'email':row['email']}

@app.post('/auth/logout')
def logout(authorization:str=Header(default=''),account=Depends(user)):
    with db() as con: con.execute('DELETE FROM sessions WHERE token=?',(digest(authorization[7:]),))
    return {'ok':True}

@app.get('/teams')
def teams(account=Depends(user)):
    with db() as con: return [dict(row) for row in con.execute('SELECT teams.id,teams.name,members.role FROM teams JOIN members ON teams.id=members.team_id WHERE members.user_id=?',(account['id'],))]

@app.post('/teams')
def create_team(body:TeamName,account=Depends(user)):
    tid=secrets.token_hex(16)
    with db() as con:
        con.execute('INSERT INTO teams VALUES(?,?)',(tid,body.name))
        con.execute('INSERT INTO members VALUES(?,?,?)',(tid,account['id'],'owner'))
    return {'id':tid,'name':body.name,'role':'owner'}

@app.post('/teams/{tid}/invites')
def invite(tid:str,body:Invite,account=Depends(user)):
    code=secrets.token_urlsafe(32)
    with db() as con:
        member(con,tid,account['id'],True)
        con.execute('INSERT INTO invites VALUES(?,?,?,?)',(digest(code),tid,body.email.strip().lower(),time.time()+48*3600))
    return {'code':code,'expiresInHours':48}

@app.get('/teams/{tid}/reviews')
def reviews(tid:str,account=Depends(user)):
    with db() as con:
        member(con,tid,account['id'])
        return [dict(row) for row in con.execute('SELECT id,revision,updated,author,json_extract(payload,\'$.capture.snapshot.title\') AS title,json_extract(payload,\'$.approval.status\') AS decision FROM reviews WHERE team_id=? ORDER BY updated DESC LIMIT 100',(tid,))]

@app.get('/teams/{tid}/reviews/{rid}')
def review(tid:str,rid:str,account=Depends(user)):
    with db() as con:
        member(con,tid,account['id'])
        row=con.execute('SELECT * FROM reviews WHERE id=? AND team_id=?',(rid,tid)).fetchone()
        if not row: raise HTTPException(404,'Review not found.')
        return {'payload':json.loads(row['payload']),'revision':row['revision']}

@app.put('/teams/{tid}/reviews/{rid}')
def save_review(tid:str,rid:str,body:ReviewInput,account=Depends(user)):
    try: payload=SavedRecord.model_validate(body.payload).model_dump(exclude_none=True)
    except ValidationError: raise HTTPException(422,'Invalid comparison or review data.')
    if payload.get('id')!=rid: raise HTTPException(422,'Review ID mismatch.')
    # Validate image payloads and finding data before storing arbitrary client input.
    try:
        CompareRequest.model_validate({'design':payload['design']['image'],'actual':payload['capture']['image'],'snapshot':payload['capture']['snapshot']})
        Analysis.model_validate(payload)
        for image in (payload['design']['image'],payload['capture']['image']): decode_image(image)
        if payload.get('sourceDesign'): decode_image(payload['sourceDesign']['image'])
    except (KeyError,ValueError): raise HTTPException(422,'Invalid comparison record.')
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        member(con,tid,account['id'])
        row=con.execute('SELECT revision,team_id FROM reviews WHERE id=?',(rid,)).fetchone()
        if row and row['team_id']!=tid: raise HTTPException(403,'Review belongs to another workspace.')
        if (row['revision'] if row else 0)!=body.revision: raise HTTPException(409,'Someone changed this review. Reopen it before saving your changes.')
        decision=payload.get('approval',{})
        if decision.get('status')=='approved':
            if not decision.get('reviewer','').strip() or any(not issue.get('dismissed') and issue.get('review',{}).get('status') not in ('accepted','fixed') for issue in payload['issues']): raise HTTPException(422,'Resolve or accept all findings and name a reviewer before approval.')
        # Attribute server audit events to the signed-in user, independent of display labels.
        revision=body.revision+1
        con.execute('INSERT INTO reviews VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated=excluded.updated,author=excluded.author',(rid,tid,json.dumps(payload),revision,time.time(),account['email']))
        con.execute('INSERT INTO audit(team_id,review_id,user_id,action,created) VALUES(?,?,?,?,?)',(tid,rid,account['id'],f'saved revision {revision}; decision {decision.get("status","draft")}',time.time()))
    return {'revision':revision}

@app.get('/teams/{tid}/reviews/{rid}/audit')
def audit(tid:str,rid:str,account=Depends(user)):
    with db() as con:
        member(con,tid,account['id'])
        return [dict(row) for row in con.execute('SELECT audit.action,audit.created,users.email FROM audit JOIN users ON users.id=audit.user_id WHERE team_id=? AND review_id=? ORDER BY audit.id DESC LIMIT 100',(tid,rid))]

@app.get('/health')
def health():
    return {'ok':True,'configured':True,'extensionConfigured':True,'engine':ENGINE,'externalServices':False,'team':True}

@app.post('/compare')
async def compare(body:CompareRequest,account=Depends(user)):
    async with limit:
        design,actual=await asyncio.to_thread(lambda:(decode_image(body.design),decode_image(body.actual)))
        result=await asyncio.to_thread(analyze,design,actual,body.snapshot.model_dump(),body.options.model_dump())
        Analysis.model_validate(result)
        return {**result,'options':body.options.model_dump()}


assets=Path('dist')
if assets.is_dir():
    from fastapi.responses import FileResponse
    @app.get('/')
    def index(): return FileResponse(assets/'panel.html')
    app.mount('/',StaticFiles(directory=assets),name='web')
