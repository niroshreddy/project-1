import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import pytest
from fastapi.testclient import TestClient
from backend import app as local_app
from backend import journey_agent,journey_api,journey_ai
from backend.journey_models import JourneyContract,DiscoverRequest,LocalPlan,validate_target
from backend.journey_demo import checkout_html

@pytest.fixture
def fixture_site(monkeypatch):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body=checkout_html('fixed' if self.path=='/fixed' else 'buggy').encode()
            self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base=f'http://127.0.0.1:{server.server_port}'
    monkeypatch.setenv('JOURNEY_ALLOWED_ORIGINS',base)
    try:yield base
    finally:server.shutdown();server.server_close()

def contract(url):
    return JourneyContract(url=url,formSelector='#address-form',submitSelector='#continue',postalSelector='#postal',successSelector='#success',
       fields=[dict(selector='#full-name',label='Full name',value='Test Buyer'),dict(selector='#street',label='Street',value='123 Example Street'),dict(selector='#city',label='City',value='Austin'),dict(selector='#state',label='State',value='TX'),dict(selector='#country',label='Country',value='US')],viewports=[dict(width=390,height=800)],build='fixture',stagingConfirmed=True)

def test_target_and_local_model_boundaries(monkeypatch):
    monkeypatch.setenv('JOURNEY_ALLOWED_ORIGINS','https://staging.example.com')
    assert validate_target('https://staging.example.com/address')=='https://staging.example.com'
    for url in ['https://other.example.com/','https://user:secret@staging.example.com/','https://staging.example.com/?token=secret','file:///etc/passwd','http://169.254.169.254/']:
        with pytest.raises(ValueError):validate_target(url)
    monkeypatch.setenv('JOURNEY_OLLAMA_URL','https://api.external.example.com')
    with pytest.raises(ValueError):journey_ai.endpoint()
    assert journey_ai.local_models({'models':[dict(name='local:3b',size=2_000_000_000),dict(name='model-cloud',size=2_000_000_000),dict(name='alias',size=200,remote_host='https://cloud.example')]})==['local:3b']
    with pytest.raises(ValueError):LocalPlan.model_validate(dict(scenarios=['purchase'],rationale='unsafe'))

def test_contract_requires_staging_acknowledgement():
    data=contract('http://127.0.0.1:8765/journey/demo/buggy').model_dump();data['stagingConfirmed']=False
    with pytest.raises(ValueError):JourneyContract.model_validate(data)

def test_real_browser_discovers_and_reproduces_recovery_failures_then_fixed_form_passes(fixture_site):
    discovered=asyncio.run(journey_agent.discover(DiscoverRequest(url=fixture_site+'/buggy',formSelector='#address-form')))
    assert any(field['selector']=='#postal' for field in discovered['fields'])
    plan=LocalPlan(scenarios=['invalid-postal','keyboard-invalid-postal'],rationale='Bounded test fixture').model_dump()
    broken=asyncio.run(journey_agent.investigate(contract(fixture_site+'/buggy'),threading.Event(),lambda *args:None,plan))
    assert len(broken['attempts'])==4
    assert all(attempt['status']=='completed' for attempt in broken['attempts']),[(case['status'],case.get('reason')) for case in broken['attempts']]
    assert any(finding['code']=='data-loss' and finding['reproductions']==2 and finding['evidenceLevel']=='reproduced' for finding in broken['findings'])
    assert any(finding['code']=='recovery-incomplete' for finding in broken['findings'])
    assert broken['attempts'][0]['evidence']['invalid'].startswith('data:image/png;base64,')
    fixed=asyncio.run(journey_agent.investigate(contract(fixture_site+'/fixed'),threading.Event(),lambda *args:None,plan))
    assert all(attempt['status']=='completed' for attempt in fixed['attempts']),[(case['status'],case.get('reason')) for case in fixed['attempts']]
    assert fixed['findings']==[],fixed['findings']
    assert fixed['planner']=='baseline-replay'

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('EXTENSION_ID','test-extension');monkeypatch.setenv('JOURNEY_DATA_DIR',str(tmp_path/'runs'))
    monkeypatch.setenv('JOURNEY_ALLOWED_ORIGINS','http://127.0.0.1:8765')
    journey_api._jobs.clear();journey_api._cancels.clear()
    return TestClient(local_app.app,headers={'Origin':'chrome-extension://test-extension'})

def test_job_api_origin_isolation_and_review_constraints(client,monkeypatch):
    async def fake_investigate(body,cancel,progress,frozen_plan=None):
        return dict(contract=body.model_dump(),plan={'scenarios':['invalid-postal'],'rationale':'fixture','hypotheses':[]},planner='built-in',attempts=[{'status':'completed'}],findings=[],summary='fixture',limitations=[],completedAt='now')
    monkeypatch.setattr(journey_agent,'investigate',fake_investigate)
    response=client.post('/journey/runs',json=contract('http://127.0.0.1:8765/journey/demo/buggy').model_dump())
    assert response.status_code==200,response.text
    import time
    run_id=response.json()['id']
    for _ in range(100):
        result=client.get('/journey/runs/'+run_id).json()
        if result['status'] in ('completed','failed'):break
        time.sleep(.01)
    assert result['status']=='completed',result
    assert client.get('/journey/runs/'+run_id,headers={'Origin':'https://untrusted.example'}).status_code==403
    assert client.post('/journey/runs/'+run_id+'/review',json=dict(reviewer='QA',outcome='verified-fixed',note='')).status_code==422
    assert client.post('/journey/runs/'+run_id+'/review',json=dict(reviewer='QA',outcome='confirmed-issue',note='Reviewed')).status_code==200
    assert client.get('/journey/runs/'+run_id).json()['reviews'][0]['reviewer']=='QA'
    assert client.get('/journey/runs/not-a-run').status_code==404
    assert client.get('/journey/demo/fixed',headers={'Origin':''}).status_code==200
    assert client.delete('/journey/runs/'+run_id).status_code==200
    assert client.get('/journey/runs/'+run_id).status_code==404


def test_unapproved_submission_is_inconclusive_not_a_usability_finding(fixture_site,monkeypatch):
    original=journey_agent.form_info
    async def form_with_blocked_submission(page,selector):
        form,data=await original(page,selector)
        await page.evaluate("""()=>{document.querySelector('form').addEventListener('submit',()=>{fetch('/validate-address',{method:'POST',body:'{}'}).catch(()=>{});});}""")
        return form,data
    monkeypatch.setattr(journey_agent,'form_info',form_with_blocked_submission)
    plan=LocalPlan(scenarios=['invalid-postal'],rationale='Boundary fixture').model_dump()
    result=asyncio.run(journey_agent.investigate(contract(fixture_site+'/buggy'),threading.Event(),lambda *args:None,plan))
    assert all(item['status']=='inconclusive' for item in result['attempts']),result['attempts']
    assert result['findings']==[]
    assert any(item['blockedRequests'] for item in result['attempts'])


def test_pre_cancelled_investigation_stops_without_a_fix_claim(fixture_site):
    cancel=threading.Event();cancel.set()
    with pytest.raises(journey_agent.Cancelled):
        asyncio.run(journey_agent.investigate(contract(fixture_site+'/fixed'),cancel,lambda *args:None))

def test_optional_local_ai_plan_is_schema_bound_and_uses_only_loopback(monkeypatch):
    calls=[]
    class Response:
        def __init__(self,data):self.data=data
        def raise_for_status(self):pass
        def json(self):return self.data
    class Client:
        def __init__(self,**kwargs):assert kwargs['trust_env'] is False
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,url):
            calls.append(url);return Response({'models':[{'name':'test-local:3b','size':2_000_000_000}]})
        async def post(self,url,json):
            calls.append(url)
            if url.endswith('/api/show'):return Response({'capabilities':['completion']})
            assert '123 Example Street' not in json['prompt']
            return Response({'response':'{"scenarios":["invalid-postal"],"rationale":"Test error recovery first","hypotheses":["Feedback may be hard to associate with its field; validate in the browser."]}'})
    monkeypatch.setenv('JOURNEY_OLLAMA_URL','http://127.0.0.1:11434')
    monkeypatch.setattr(journey_ai.httpx,'AsyncClient',Client)
    body=contract('http://127.0.0.1:8765/journey/demo/buggy');body.model='test-local:3b'
    result=asyncio.run(journey_ai.plan(body,[{'label':'Postal code','kind':'text','required':True}]))
    assert result.scenarios==['invalid-postal']
    assert all(url.startswith('http://127.0.0.1:11434/') for url in calls)
