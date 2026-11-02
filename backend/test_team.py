import pytest
from fastapi.testclient import TestClient
from backend import team_app as module
from backend.test_local import payload

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('TEAM_DB',str(tmp_path/'team.sqlite3'))
    monkeypatch.setenv('TEAM_BOOTSTRAP_KEY','test-bootstrap-secret-0123456789abcdef')
    module.failed.clear()
    return TestClient(module.app)

def account(client,email='owner@example.com',invite='',bootstrap='test-bootstrap-secret-0123456789abcdef'):
    body=dict(email=email,password='a-long-test-password',invite=invite,bootstrap=bootstrap)
    response=client.post('/auth/register',json=body)
    assert response.status_code==200,response.text
    token=client.post('/auth/login',json=body).json()['token']
    return {'Authorization':'Bearer '+token}

def record():
    images=payload()
    return dict(id='review-1',createdAt='2026-11-01T00:00:00Z',design=dict(image=images['design'],name='ref',width=1000,height=600),capture=dict(image=images['actual'],snapshot=images['snapshot'],capturedAt='now'),summary='Identical',issues=[],model='local-rules-v3',diff=dict(changedPercent=0,regions=[]))

def test_bootstrap_and_sessions(client):
    assert client.get('/teams').status_code==401
    assert client.post('/auth/register',json=dict(email='owner@example.com',password='a-long-test-password')).status_code==403
    owner=account(client)
    assert client.get('/teams',headers=owner).json()==[]
    assert client.post('/auth/logout',headers=owner).status_code==200
    assert client.get('/teams',headers=owner).status_code==401

def test_invites_are_email_bound_single_use_and_workspace_access_isolated(client):
    owner=account(client)
    team=client.post('/teams',json={'name':'Product'},headers=owner).json()['id']
    code=client.post(f'/teams/{team}/invites',json={'email':'member@example.com'},headers=owner).json()['code']
    assert client.post('/auth/register',json=dict(email='other@example.com',password='a-long-test-password',invite=code)).status_code==403
    member=account(client,'member@example.com',code,'')
    assert client.get('/teams',headers=member).json()[0]['id']==team
    assert client.post(f'/teams/{team}/invites',json={'email':'next@example.com'},headers=member).status_code==403
    assert client.get('/teams/not-your-team/reviews',headers=member).status_code==403
    assert client.post('/auth/register',json=dict(email='member@example.com',password='a-long-test-password',invite=code)).status_code==403

def test_shared_review_conflicts_and_audit(client):
    owner=account(client)
    team=client.post('/teams',json={'name':'Product'},headers=owner).json()['id']
    path=f'/teams/{team}/reviews/review-1'
    body=dict(payload=record(),revision=0)
    assert client.put(path,json=body,headers=owner).json()['revision']==1
    assert client.put(path,json=body,headers=owner).status_code==409
    assert client.get(path,headers=owner).json()['payload']['id']=='review-1'
    audit=client.get(path+'/audit',headers=owner).json()
    assert audit[0]['email']=='owner@example.com'
    assert client.put(path,json=dict(payload={**record(),'id':'different'},revision=1),headers=owner).status_code==422

def test_hosted_analysis_identical_images(client):
    owner=account(client)
    response=client.post('/compare',json=payload(),headers=owner)
    assert response.status_code==200,response.text
    assert response.json()['issues']==[]
    assert client.post('/compare',json=payload()).status_code==401

def test_approval_requires_reviewer_and_resolved_findings(client):
    owner=account(client)
    team=client.post('/teams',json={'name':'Product'},headers=owner).json()['id']
    value=record();value['approval']=dict(status='approved',reviewer='',note='',updatedAt='now')
    assert client.put(f'/teams/{team}/reviews/review-1',json=dict(payload=value,revision=0),headers=owner).status_code==422
