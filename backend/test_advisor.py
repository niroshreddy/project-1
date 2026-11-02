import asyncio
import json
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from backend import advisor
from backend.app import app

def payload():
    return {'question':'How should this mobile form improve?', 'evidence':{'page':'https://example.test','capturedAt':'2026-10-31T12:00:00Z','width':390,'height':844,'overflow':30,'total':1,'controls':[{'id':'e1','tag':'input','name':'','width':20,'height':20,'interactive':True,'needsLabel':True,'invalid':True,'errorAssociated':False}]}}

def test_measured_checks_are_explicit_and_qa_not_claimed_run():
    result=asyncio.run(advisor.advise(advisor.Ask.model_validate(payload())))
    assert result['mode']=='built-in'
    assert {x['id'] for x in result['findings']}=={'reflow','labels','target','errors'}
    assert result['recommendations']==[]
    assert 'do not interpret your question' in result['answer']
    assert all(x['qa'] for x in result['findings'])

def test_bounded_evidence_rejects_values_and_duplicate_ids():
    body=payload();body['evidence']['controls'][0]['value']='secret'
    with pytest.raises(ValidationError):advisor.Ask.model_validate(body)
    body=payload();body['evidence']['controls']*=2
    with pytest.raises(ValidationError):advisor.Ask.model_validate(body)

def test_local_route_requires_extension_and_not_on_team(monkeypatch):
    monkeypatch.setenv('EXTENSION_ID','advisor-test')
    with TestClient(app) as client:
        assert client.post('/advisor/ask',json=payload()).status_code==403
        response=client.post('/advisor/ask',headers={'Origin':'chrome-extension://advisor-test'},json=payload())
        assert response.status_code==200
        assert response.json()['mode']=='built-in'
    from backend.team_app import app as team_app
    assert not any(getattr(route,'path','').startswith('/advisor') for route in team_app.routes)

@pytest.mark.parametrize('bad_ref',[False,True])
def test_local_model_schema_and_evidence_grounding(monkeypatch,bad_ref):
    async def status():return {'ready':True,'models':['local:3b']}
    monkeypatch.setattr(advisor.journey_ai,'status',status)
    calls=[]
    class Response:
        def __init__(self,data):self.data=data
        def raise_for_status(self):pass
        def json(self):return self.data
    class Client:
        def __init__(self,**kwargs):assert kwargs['trust_env'] is False
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,json):
            calls.append(url)
            if url.endswith('/api/show'):return Response({})
            assert json['format']['additionalProperties'] is False
            data={'answer':'Review error recovery at this width.','recommendations':[{'title':'Review the error message','reasoning':'The snapshot has an invalid control.','recommendation':'Associate helpful error text.','evidenceIds':['unknown' if bad_ref else 'e1'],'qa':['Trigger an error and verify focus and field preservation.']}],'uncertainties':['Recovery has not been exercised.']}
            return Response({'response':__import__('json').dumps(data)})
    monkeypatch.setattr(advisor.httpx,'AsyncClient',Client)
    monkeypatch.setenv('JOURNEY_OLLAMA_URL','http://127.0.0.1:11434')
    body=advisor.Ask.model_validate({**payload(),'useLocalAI':True,'model':'local:3b'})
    if bad_ref:
        with pytest.raises(HTTPException) as error:asyncio.run(advisor.advise(body))
        assert error.value.status_code==503
    else:
        result=asyncio.run(advisor.advise(body));assert result['mode']=='local-ai'
        assert result['recommendations'][0]['evidenceIds']==['e1']
    assert all(url.startswith('http://127.0.0.1:11434/') for url in calls)

def test_no_silent_ai_fallback(monkeypatch):
    async def status():return {'ready':False,'models':[]}
    monkeypatch.setattr(advisor.journey_ai,'status',status)
    with pytest.raises(HTTPException) as error:asyncio.run(advisor.advise(advisor.Ask.model_validate({**payload(),'useLocalAI':True,'model':'missing'})))
    assert error.value.status_code==503
