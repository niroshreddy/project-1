"""Local-only job API for the checkout recovery MVP."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import re
import threading
import uuid
from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from backend import journey_agent,journey_ai
from backend.journey_models import DiscoverRequest,JourneyContract,VerifyRequest,ReviewRequest,validate_target,allowed_origins
from backend.journey_demo import checkout_html

_lock=threading.RLock()
_slot=threading.Lock()
_jobs={}
_cancels={}

def directory():
    result=Path(os.getenv('JOURNEY_DATA_DIR','data/journeys')).resolve()
    result.mkdir(parents=True,exist_ok=True)
    return result

def path_for(run_id):
    if not re.fullmatch('[a-f0-9]{32}',run_id): raise HTTPException(404,'Run not found.')
    return directory()/(run_id+'.json')

def load(run_id):
    with _lock:
        if run_id in _jobs:return json.loads(json.dumps(_jobs[run_id]))
        path=path_for(run_id)
        if not path.is_file():raise HTTPException(404,'Run not found.')
        job=json.loads(path.read_text(encoding='utf-8'))
        if job['status'] in ('queued','running','cancelling'):
            job['status']='interrupted';job['progress']='The backend restarted before this investigation completed. Start a new run; no fix claim was recorded.';persist(job)
        return job

def preview(job):
    return {'id':job['id'],'status':job['status'],'createdAt':job['createdAt'],'build':job['contract']['build'],'url':job['contract']['url'],'baselineId':job.get('baselineId'),'findings':len(job.get('result',{}).get('findings',[]))}

def persist(job):
    path=path_for(job['id']);temporary=path.with_suffix('.tmp')
    data=json.dumps(job)
    if len(data.encode())>48_000_000:raise ValueError('Evidence exceeds 48 MB. Use fewer/smaller viewports.')
    temporary.write_text(data,encoding='utf-8');temporary.replace(path)
    summary=path.with_suffix('.summary');pending=path.with_suffix('.summary.tmp')
    pending.write_text(json.dumps(preview(job)),encoding='utf-8');pending.replace(summary)

def start(contract,baseline=None):
    validate_target(contract.url)
    if importlib.util.find_spec('playwright') is None:raise HTTPException(503,'Install backend/requirements.txt; Python Playwright is required.')
    if not _slot.acquire(blocking=False):raise HTTPException(429,'A journey discovery/run is already active. Wait or cancel it first.')
    run_id=uuid.uuid4().hex;cancel=threading.Event()
    job={'id':run_id,'status':'queued','progress':'Waiting for isolated browser…','createdAt':journey_agent.now(),'baselineId':baseline['id'] if baseline else None,'contract':contract.model_dump()}
    try:
        with _lock:_jobs[run_id]=job;_cancels[run_id]=cancel;persist(job)
    except Exception:
        with _lock:_jobs.pop(run_id,None);_cancels.pop(run_id,None)
        _slot.release();raise
    def worker():
        def progress(message,attempts=None):
            with _lock:
                job['progress']=message
                if attempts is not None:job['completedAttempts']=len(attempts)
        try:
            with _lock:job['status']='running'
            result=asyncio.run(asyncio.wait_for(journey_agent.investigate(contract,cancel,progress,baseline['result']['plan'] if baseline else None),timeout=240))
            with _lock:
                if cancel.is_set():raise journey_agent.Cancelled()
                job['result']=result;job['status']='completed';job['progress']='Investigation complete. Review observed findings and hypotheses separately.'
                if baseline:
                    current={finding['key'] for finding in result['findings']}
                    completed={(item['scenario'],item['viewport']['width'],item['viewport']['height']) for item in result['attempts'] if item['status']=='completed'}
                    job['verification']=[{'key':finding['key'],'detail':finding['detail'],'outcome':'still-detected' if finding['key'] in current else 'not-detected' if (finding['scenario'],finding['viewport']['width'],finding['viewport']['height']) in completed and all(item['status']=='completed' for item in result['attempts'] if item['scenario']==finding['scenario'] and item['viewport']==finding['viewport']) else 'inconclusive'} for finding in baseline['result']['findings']]
                persist(job)
        except journey_agent.Cancelled:
            with _lock:job['status']='cancelled';job['progress']='Cancelled. No success or fix claim was recorded.';persist(job)
        except Exception as error:
            with _lock:
                job['status']='failed';job['error']='Investigation timed out.' if isinstance(error,TimeoutError) else str(error)[:700];job['progress']='Run failed. No fix claim was recorded.'
                job.pop('result',None);persist(job)
        finally:
            with _lock:
                _cancels.pop(run_id,None)
                completed=[item for item in _jobs.values() if item['status'] not in ('queued','running','cancelling')]
                for old in sorted(completed,key=lambda value:value['createdAt'],reverse=True)[5:]:_jobs.pop(old['id'],None)
            _slot.release()
    threading.Thread(target=worker,name='journey-'+run_id[:8],daemon=True).start()
    return {'id':run_id}

def register_journey_routes(app):
    @app.get('/journey/status')
    async def status():
        return {'browserInstalled':await asyncio.to_thread(journey_agent.browser_available),'localAI':await journey_ai.status(),'allowedOrigins':sorted(allowed_origins()),'active':_slot.locked(),'externalAI':False,'mode':'local-only'}

    @app.post('/journey/discover')
    async def discover(body:DiscoverRequest):
        try:validate_target(body.url)
        except ValueError as error:raise HTTPException(422,str(error))
        if not _slot.acquire(blocking=False):raise HTTPException(429,'Another discovery or run is active.')
        try:return await asyncio.to_thread(lambda:asyncio.run(journey_agent.discover(body)))
        except Exception as error:raise HTTPException(422,str(error)[:600])
        finally:_slot.release()

    @app.post('/journey/runs')
    def create(body:JourneyContract):
        try:return start(body)
        except ValueError as error:raise HTTPException(422,str(error))

    @app.get('/journey/runs')
    def runs():
        items={}
        for path in sorted(directory().glob('*.summary'),key=lambda path:path.stat().st_mtime,reverse=True)[:20]:
            try:
                data=json.loads(path.read_text(encoding='utf-8'));items[data['id']]=data
                with _lock:
                    if data['status'] in ('queued','running','cancelling') and data['id'] not in _jobs:data['status']='interrupted'
            except (ValueError,OSError):continue
        with _lock:items.update({key:preview(job) for key,job in _jobs.items()})
        return sorted(items.values(),key=lambda value:value['createdAt'],reverse=True)[:20]

    @app.get('/journey/runs/{run_id}')
    def run(run_id:str):
        job=load(run_id)
        if job['status'] in ('running','queued','cancelling'):
            return {key:value for key,value in job.items() if key!='result'}
        return job

    @app.post('/journey/runs/{run_id}/cancel')
    def cancel(run_id:str):
        load(run_id)
        with _lock:
            event=_cancels.get(run_id)
            if event:event.set();_jobs[run_id]['status']='cancelling';_jobs[run_id]['progress']='Cancelling after the current bounded browser operation…'
        return {'ok':True}

    @app.delete('/journey/runs/{run_id}')
    def delete(run_id:str):
        with _lock:
            job=load(run_id)
            if job['status'] in ('queued','running','cancelling'):raise HTTPException(409,'Cancel the active investigation before deleting its report.')
            path_for(run_id).unlink(missing_ok=True);path_for(run_id).with_suffix('.summary').unlink(missing_ok=True);_jobs.pop(run_id,None)
        return {'ok':True}

    @app.post('/journey/runs/{run_id}/verify')
    def verify(run_id:str,body:VerifyRequest):
        baseline=load(run_id)
        if baseline['status']!='completed' or not baseline.get('result'):raise HTTPException(422,'Select a completed baseline run.')
        contract={**baseline['contract'],'url':body.url,'build':body.build,'stagingConfirmed':body.stagingConfirmed}
        try:return start(JourneyContract.model_validate(contract),baseline)
        except ValueError as error:raise HTTPException(422,str(error))

    @app.post('/journey/runs/{run_id}/review')
    def review(run_id:str,body:ReviewRequest):
        with _lock:
            job=load(run_id)
            if job['status']!='completed':raise HTTPException(422,'Review a completed investigation.')
            if not body.reviewer.strip():raise HTTPException(422,'A reviewer name is required.')
            if body.outcome=='verified-fixed' and (not job.get('baselineId') or not job.get('verification') or any(item['outcome']!='not-detected' for item in job.get('verification',[])) or any(attempt['status']!='completed' for attempt in job['result']['attempts']) or job['result']['findings']):
                raise HTTPException(422,'A verified fix requires a baseline, completed checks and no remaining detected findings. Review visually before signing off.')
            job.setdefault('reviews',[]).append({**body.model_dump(),'at':journey_agent.now()})
            persist(job);_jobs[run_id]=job
        return {'ok':True}

    @app.get('/journey/demo/{variant}',response_class=HTMLResponse)
    def demo(variant:str):
        if variant not in ('buggy','fixed'):raise HTTPException(404)
        return HTMLResponse(checkout_html(variant))
