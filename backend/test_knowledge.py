import asyncio
import base64
import io
import json
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from backend.app import app
from backend import knowledge


def png():
    stream=io.BytesIO();Image.new('RGB',(200,100),'white').save(stream,format='PNG');return 'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()


@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('PROJECT_KNOWLEDGE_DB',str(tmp_path/'knowledge.sqlite3'))
    monkeypatch.setenv('EXTENSION_ID','knowledge-test')
    with TestClient(app,headers={'Origin':'chrome-extension://knowledge-test'}) as client: yield client


def setup(client):
    project=client.post('/knowledge/projects',json={'name':'Pilot product listing'}).json()['id']
    guideline=client.post(f'/knowledge/projects/{project}/sources',json={'title':'Brand rules','version':'v1','kind':'guideline','content':'Buy button text must be at least 16px.'}).json()['id']
    design=client.post(f'/knowledge/projects/{project}/sources',json={'title':'Approved PLP','version':'v1','kind':'figma','image':png()}).json()['id']
    return project,guideline,design


def approve(client,project,id):return client.post(f'/knowledge/projects/{project}/sources/{id}/approve',json={'approvedBy':'Reviewer'})


def rule(guideline,**overrides):
    result={'sourceId':guideline,'title':'CTA type size','expectation':'Buy is at least 16 CSS px.','kind':'min-font-size','target':'Buy','value':'16','approvedBy':'Reviewer','obligation':'mandatory'};result.update(overrides);return result


def evaluation(project,guideline,design):return dict(projectId=project,guidelineId=guideline,designId=design,comparisonId='comparison-1',capturedAt='2026-11-03T10:00:00Z',page='https://example.test/products',width=200,height=100,device='desktop',referenceImage=png(),elements=[dict(id='e1',tag='button',text='Buy',fontSize='14px',color='rgb(23, 107, 120)',width=80,height=32)])


def test_boundary_and_version_immutability(client):
    assert client.get('/knowledge/projects',headers={'Origin':'https://evil.test'}).status_code==403
    p,g,d=setup(client)
    assert client.post(f'/knowledge/projects/{p}/rules',json=rule(g)).status_code==422
    assert client.post('/knowledge/evaluate',json=evaluation(p,g,d)).status_code==422
    assert approve(client,p,g).status_code==200
    assert approve(client,p,g).status_code==409
    assert client.post(f'/knowledge/projects/{p}/sources',json={'title':'Brand rules','version':'v1','kind':'guideline','content':'Overwrite'}).status_code==409
    assert client.post(f'/knowledge/projects/{p}/sources',json={'title':'Brand rules','version':'v2','kind':'guideline','content':'A new version'}).status_code==200
    assert client.get(f'/knowledge/projects/{p}').json()['sources'][-1]['content']=='Buy button text must be at least 16px.'


def test_rule_evidence_and_frozen_report(client):
    p,g,d=setup(client);approve(client,p,g);approve(client,p,d)
    rid=client.post(f'/knowledge/projects/{p}/rules',json=rule(g)).json()['id']
    result=client.post('/knowledge/evaluate',json=evaluation(p,g,d)).json()
    assert result['referenceMatch']=='match'
    assert result['checks'][0]['status']=='difference'
    assert result['checks'][0]['evidenceIds']==['e1']
    assert result['checks'][0]['ruleId']==rid
    assert result['sources'][0]['content']=='Buy button text must be at least 16px.'
    assert result['sources'][0]['approved_by']=='Reviewer'
    assert 'image' not in result['sources'][1]
    assert result['advice']['mode']=='rules-only'
    client.post(f'/knowledge/projects/{p}/sources',json={'title':'Brand rules','version':'v2','kind':'guideline','content':'New rule'})
    assert result['sources'][0]['version']=='v1'
    assert result['rules'][0]['sourceVersion']=='v1'


def test_missing_evidence_never_claims_absence_or_pass(client):
    p,g,d=setup(client);approve(client,p,g);approve(client,p,d)
    client.post(f'/knowledge/projects/{p}/rules',json=rule(g))
    client.post(f'/knowledge/projects/{p}/rules',json=rule(g,kind='required-text',title='Required label'))
    body=evaluation(p,g,d);body['elements']=[]
    report=client.post('/knowledge/evaluate',json=body).json()
    assert [c['status'] for c in report['checks']]==['not-checked','needs-review']
    assert all(c['evidenceIds']==[] for c in report['checks'])


def test_project_and_source_isolation(client):
    p,g,d=setup(client);approve(client,p,g);approve(client,p,d)
    other=client.post('/knowledge/projects',json={'name':'Other'}).json()['id']
    assert client.get(f'/knowledge/projects/{other}/sources/{g}').status_code==404
    body=evaluation(other,g,d)
    assert client.post('/knowledge/evaluate',json=body).status_code==404
    assert client.post(f'/knowledge/projects/{other}/rules',json=rule(g)).status_code==404


def test_validation_color_and_unsupported_values(client):
    p,g,d=setup(client);approve(client,p,g);approve(client,p,d)
    assert client.post(f'/knowledge/projects/{p}/rules',json=rule(g,value='NaN')).status_code==422
    assert client.post(f'/knowledge/projects/{p}/rules',json=rule(g,kind='text-color',value='red')).status_code==422
    client.post(f'/knowledge/projects/{p}/rules',json=rule(g,kind='text-color',value='#176B78'))
    body=evaluation(p,g,d)
    assert client.post('/knowledge/evaluate',json=body).json()['checks'][0]['status']=='observed'
    body['elements'][0]['color']='rgba(23, 107, 120, 0.5)'
    assert client.post('/knowledge/evaluate',json=body).json()['checks'][0]['status']=='not-checked'
    body['elements']*=2
    assert client.post('/knowledge/evaluate',json=body).status_code==422


def test_figma_json_linkage_and_corrupt_images(client):
    p,g,d=setup(client);approve(client,p,g);approve(client,p,d)
    assert client.post(f'/knowledge/projects/{p}/sources',json={'title':'Corrupt','version':'1','kind':'figma','image':'data:image/png;base64,bm90LWFuLWltYWdl'}).status_code==422
    assert client.post(f'/knowledge/projects/{p}/sources',json={'title':'Invalid','version':'1','kind':'figma','content':'{"arbitrary":true}'}).status_code==422
    json_design=client.post(f'/knowledge/projects/{p}/sources',json={'title':'Nodes','version':'1','kind':'figma','content':'{"document":{"type":"DOCUMENT","children":[]}}'}).json()['id'];approve(client,p,json_design)
    body=evaluation(p,g,json_design)
    assert client.post('/knowledge/evaluate',json=body).json()['referenceMatch']=='not-verifiable'
    body=evaluation(p,g,d);stream=io.BytesIO();Image.new('RGB',(200,100),'red').save(stream,format='PNG');body['referenceImage']='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()
    assert client.post('/knowledge/evaluate',json=body).json()['referenceMatch']=='different'


def test_ai_unavailable_is_explicit(client,monkeypatch):
    p,g,d=setup(client);approve(client,p,g);approve(client,p,d)
    async def status():return {'models':[]}
    monkeypatch.setattr(knowledge.journey_ai,'status',status)
    body=evaluation(p,g,d);body.update(useLocalAI=True,model='local:3b')
    response=client.post('/knowledge/evaluate',json=body)
    assert response.status_code==503
    assert 'No external AI' in response.json()['detail']


@pytest.mark.parametrize('bad',['source','evidence','remote',None])
def test_local_ai_citations_and_remote_rejection(client,monkeypatch,bad):
    p,g,d=setup(client);approve(client,p,g);approve(client,p,d)
    async def status():return {'models':['local:3b']}
    monkeypatch.setattr(knowledge.journey_ai,'status',status)
    calls=[]
    class Response:
        def __init__(self,data):self.data=data
        def json(self):return self.data
        def raise_for_status(self):pass
    class Client:
        def __init__(self,**kwargs):assert kwargs['trust_env'] is False and kwargs['follow_redirects'] is False
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,json):
            calls.append((url,json))
            if url.endswith('/api/show'):return Response({'remote_host':'external'} if bad=='remote' else {})
            return Response({'response':__import__('json').dumps({'answer':'Review the Buy control against the approved rule.','recommendations':[{'title':'Review CTA','explanation':'Based on approved source and e1.','recommendation':'Check text size.','sourceIds':['unknown' if bad=='source' else g],'evidenceIds':['unknown' if bad=='evidence' else 'e1']}],'uncertainties':['Only sampled DOM is available.']})})
    monkeypatch.setattr(knowledge.httpx,'AsyncClient',Client)
    body=evaluation(p,g,d);body.update(useLocalAI=True,model='local:3b',question='Explain CTA requirements')
    response=client.post('/knowledge/evaluate',json=body)
    assert response.status_code==(503 if bad else 200)
    if not bad:
        assert response.json()['advice']['mode']=='local-ai'
        prompt=json.loads(calls[-1][1]['prompt']);assert prompt['passages'][0]['sourceId']==g
    if bad=='remote':assert len(calls)==1


def test_team_serialization_preserves_and_binds_optional_trace(client):
    from backend.team_app import SavedRecord
    from backend.test_team import record
    from pydantic import ValidationError
    p,g,d=setup(client);approve(client,p,g);approve(client,p,d)
    body=evaluation(p,g,d);trace=client.post('/knowledge/evaluate',json=body).json()
    saved=record();saved['id']=body['comparisonId'];saved['design'].update(image=png(),width=200,height=100)
    saved['capture']['snapshot'].update(url=body['page'],width=200,height=100)
    saved['capture']['capturedAt']=body['capturedAt'];saved['knowledge']=trace
    assert SavedRecord.model_validate(saved).model_dump()['knowledge']['sources'][0]['version']=='v1'
    saved['knowledge']['comparisonId']='different'
    with pytest.raises(ValidationError):SavedRecord.model_validate(saved)
