import json
from pathlib import Path
from PIL import Image,ImageDraw
from backend import component_matching as components
from backend.comparison_benchmark import render,score,metrics


def fixture(scenario):return render({'id':scenario,'scenario':scenario,'variant':1,'labels':[]})

def test_non_text_movement_and_missing_have_spatial_evidence():
    for scenario,kind in [('move','layout'),('missing','missing'),('resize','size')]:
        reference,actual,snapshot,_=fixture(scenario)
        matches=components.matches(reference,actual,snapshot)
        assert any(item['kind']==kind for item in matches),(scenario,matches)

def test_ambiguous_duplicates_and_color_changes_are_not_missing_components():
    for scenario in ('duplicate-missing','color','identical','minor-shift'):
        reference,actual,snapshot,_=fixture(scenario)
        matches=components.matches(reference,actual,snapshot)
        assert not any(item['kind']=='missing' for item in matches),scenario

def test_scoring_is_one_to_one_and_penalizes_duplicates_and_wrong_categories():
    box=dict(x=.1,y=.1,width=.2,height=.2)
    labels=[dict(category='missing',box=box)]
    result=score(labels,[dict(category='missing',box=box),dict(category='missing',box=box),dict(category='style',box=box)])
    assert (result['tp'],result['fp'],result['fn'])==(1,2,0)
    assert score(labels,[dict(category='missing',box=dict(x=.7,y=.7,width=.1,height=.1))])['fn']==1

def test_negative_false_alarm_metric_and_undefined_precision():
    row={'labels':[],'predictions':[],'score':score([],[])}
    assert metrics([row])['negativeCaseFalseAlarmRate']==0
    assert metrics([row])['precision'] is None

def test_manifest_has_fixed_positive_and_negative_cases_in_each_split():
    data=json.loads((Path(__file__).resolve().parents[1]/'benchmarks/comparison/cases.json').read_text())
    assert len({case['id'] for case in data['cases']})==24
    for split in ('development','holdout'):
        cases=[case for case in data['cases'] if case['split']==split]
        assert any(case['labels'] for case in cases) and any(not case['labels'] for case in cases)


def test_real_local_dataset_loading_and_labels(tmp_path):
    image=Image.new('RGB',(100,100),'white');image.save(tmp_path/'ref.png');image.save(tmp_path/'actual.png')
    case={'id':'real-pair','split':'holdout','_base':str(tmp_path),'reference':'ref.png','actual':'actual.png','labels':[]}
    ref,actual,snapshot,labels=render(case)
    assert ref.size==actual.size==(100,100) and labels==[]
    assert snapshot['width']==100


def test_component_finding_roundtrips_local_compare_api(monkeypatch):
    import base64,io
    from fastapi.testclient import TestClient
    from backend.app import app
    monkeypatch.setenv('EXTENSION_ID','component-test')
    ref,actual,snapshot,_=fixture('move')
    def data(image):
        buffer=io.BytesIO();image.save(buffer,format='PNG');return 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
    with TestClient(app,headers={'Origin':'chrome-extension://component-test'}) as client:
        response=client.post('/compare',json={'design':data(ref),'actual':data(actual),'snapshot':snapshot})
        assert response.status_code==200,response.text
        assert any(issue['title']=='Visual component position may differ' and issue['basis']=='possible' for issue in response.json()['issues'])
