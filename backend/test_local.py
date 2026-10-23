import base64
import io
import socket
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont
from backend import app as module
from backend import local_engine as engine


def data(image):
    buf = io.BytesIO(); image.save(buf, format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('EXTENSION_ID', 'test-extension')
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    return TestClient(module.app, headers={'Origin':'chrome-extension://test-extension'})


def snapshot():
    return dict(url='https://example.com',title='Example',width=1000,height=600,dpr=1,scrollX=0,scrollY=0,elements=[])


def payload():
    image = data(Image.new('RGB', (1000,600), 'white'))
    return dict(design=image,actual=image,snapshot=snapshot())


def test_identical_endpoint_needs_no_api_key(client):
    response = client.post('/compare', json=payload())
    assert response.status_code == 200, response.text
    assert response.json()['issues'] == []
    assert response.json()['model'] == engine.ENGINE
    assert response.json()['diff']['changedPercent'] == 0


def test_visual_regions_and_normalized_boxes():
    design = Image.new('RGB', (1000,600), 'white'); actual = design.copy()
    ImageDraw.Draw(actual).rectangle((200,100,400,300),fill='red')
    result = engine.visual_diff(design, actual)
    assert 5 < result['changedPercent'] < 9
    assert result['regions']
    for box in result['regions']:
        module.Box.model_validate(box)


def test_scaled_reference_matches():
    design=Image.new('RGB',(1000,600),'white'); ImageDraw.Draw(design).rectangle((100,100,200,200),fill='blue')
    result=engine.visual_diff(design.resize((2000,1200)),design)
    assert result['changedPercent'] < .1


def test_aspect_ratio_rejected(client):
    request=payload(); request['design']=data(Image.new('RGB',(100,100)))
    assert client.post('/compare',json=request).status_code == 422


def test_capture_viewport_mismatch_rejected(client):
    request=payload(); request['snapshot']['height']=100
    assert client.post('/compare',json=request).status_code == 422


def test_minor_ratio_difference_is_normalized_with_a_note(client):
    request=payload();request['design']=data(Image.new('RGB',(1000,620),'white'))
    response=client.post('/compare',json=request)
    assert response.status_code==200
    assert response.json()['issues']==[]
    assert 'automatically normalized' in response.json()['summary']


def test_ratio_tolerance_boundary():
    actual=Image.new('RGB',(1000,600),'white')
    assert engine.visual_diff(Image.new('RGB',(1099,600),'white'),actual)['regions']==[]
    with pytest.raises(HTTPException):
        engine.visual_diff(Image.new('RGB',(1101,600),'white'),actual)


def test_real_change_survives_minor_ratio_normalization(monkeypatch):
    design=Image.new('RGB',(1000,620),'white');actual=Image.new('RGB',(1000,600),'white')
    ImageDraw.Draw(actual).rectangle((300,200,400,250),fill='blue')
    monkeypatch.setattr(engine,'read_text',lambda image:[])
    result=engine.analyze(design,actual,snapshot())
    assert result['issues'] and 'automatically normalized' in result['summary']


def test_invalid_image(client):
    request=payload(); request['design']='data:image/png;base64,invalid'
    assert client.post('/compare',json=request).status_code == 422


def test_origin_boundary(client):
    assert client.post('/compare',json=payload(),headers={'Origin':'https://evil.example'}).status_code == 403
    assert client.options('/compare',headers={'Access-Control-Request-Method':'POST'}).headers['access-control-allow-origin'] == 'chrome-extension://test-extension'


def test_no_extension_configuration(client,monkeypatch):
    monkeypatch.delenv('EXTENSION_ID')
    assert client.post('/compare',json=payload()).status_code == 403


def run_rules(expected, actual, elements=None):
    image=Image.new('RGB',(1000,600),'white')
    state=snapshot();state['elements']=elements or []
    diff=dict(changedPercent=10,regions=[dict(x=.1,y=.1,width=.7,height=.5)])
    return engine.compare_rules(image,image,state,diff,expected,actual)


def text(value,x=.1,y=.1,w=.2,h=.05,source='ocr'):
    return engine.TextRun(value,dict(x=x,y=y,width=w,height=h),.99,source)


def test_shifted_text_measured_in_css_pixels():
    issues=run_rules([text('Account settings')],[text('Account settings',x=.2)])
    result=next(i for i in issues if i['category']=='layout')
    assert result['basis']=='measured'
    assert '+100 px' in result['explanation']


def test_text_mismatch_is_possible():
    issues=run_rules([text('Account settings')],[text('Privacy options')])
    result=next(i for i in issues if i['category']=='text')
    assert result['basis']=='possible'
    assert result['expected']=='Account settings'
    assert result['actual']=='Privacy options'


def test_missing_label_is_never_asserted_as_fact():
    issues=run_rules([text('Save changes')],[])
    result=next(i for i in issues if i['category']=='missing')
    assert result['title'].startswith('Possibly')
    assert result['basis']=='possible' and result['confidence'] < .75


def test_dom_text_prevents_false_missing_label():
    ref=text('Save changes')
    issues=run_rules([ref],[],[dict(text='Save changes',box=ref.box)])
    assert not any(i['category']=='missing' for i in issues)


def test_wrapped_ocr_text_does_not_create_missing_label():
    issues=run_rules([text('Account settings')],[text('Account'),text('settings',y=.2)])
    assert not any(i['category']=='missing' for i in issues)


def test_repeated_labels_match_nearest_one_to_one():
    pairs,missing,_=engine.match_text([text('View details',x=.1),text('View details',x=.6)],
                                     [text('View details',x=.6),text('View details',x=.1)])
    assert len(pairs)==2 and not missing
    assert all(a.box['x']==b.box['x'] for a,b,_ in pairs)


def test_vertical_spacing_uses_glyph_bounds():
    issues=run_rules([text('First heading'),text('Second heading',y=.25)],
                     [text('First heading'),text('Second heading',y=.30)])
    result=next(i for i in issues if i['category']=='spacing')
    assert result['annotation']=='measurement'
    assert 'not CSS margin' in result['explanation']


def test_every_finding_validates():
    issues=run_rules([text('Save changes')],[text('Save changes',x=.3,h=.09)])
    assert issues
    for issue in issues:
        module.Finding.model_validate(issue)


def test_ocr_and_comparison_work_with_network_connections_forbidden(monkeypatch):
    def forbidden(*args,**kwargs):
        raise AssertionError('Local comparison must not connect to any network service')
    monkeypatch.setattr(socket.socket,'connect',forbidden)
    monkeypatch.setattr(socket,'create_connection',forbidden)
    design=Image.new('RGB',(1000,600),'white')
    draw=ImageDraw.Draw(design);font=ImageFont.load_default(size=40)
    draw.text((80,90),'ACCOUNT SETTINGS',font=font,fill='black')
    actual=Image.new('RGB',(1000,600),'white')
    ImageDraw.Draw(actual).text((180,90),'ACCOUNT SETTINGS',font=font,fill='black')
    result=engine.analyze(design,actual,snapshot())
    assert result['model']==engine.ENGINE
    assert any(i['category']=='layout' for i in result['issues']),result
    assert 'OCR read' in result['summary']


def test_local_engine_failure_is_actionable(client,monkeypatch):
    def fail(*args): raise RuntimeError('private internal details')
    monkeypatch.setattr(module,'analyze',fail)
    response=client.post('/compare',json=payload())
    assert response.status_code==503
    assert 'Install backend/requirements.txt' in response.text
    assert 'private internal details' not in response.text


def test_health_has_no_api_key_requirement(client):
    response=client.get('/health')
    assert response.status_code==200
    assert response.json()['ocrReady'] is True
    assert response.json()['externalServices'] is False


def test_same_page_at_different_dpi_has_no_ocr_findings(monkeypatch):
    design=Image.new('RGB',(1000,600),'white')
    draw=ImageDraw.Draw(design)
    draw.text((350,150),'Search the web',font=ImageFont.load_default(size=30),fill='black')
    draw.rectangle((300,250,700,300),outline='#777777',width=2)
    def unexpected(*args): raise AssertionError('OCR should not run without meaningful changed regions')
    monkeypatch.setattr(engine,'read_text',unexpected)
    result=engine.analyze(design.resize((2000,1200)),design,snapshot())
    assert result['issues']==[]


def test_same_screenshot_with_small_color_noise_has_no_findings(monkeypatch):
    design=Image.new('RGB',(1000,600),'white')
    ImageDraw.Draw(design).text((100,100),'Search',font=ImageFont.load_default(size=32),fill='black')
    observed=Image.fromarray(__import__('numpy').clip(__import__('numpy').asarray(design).astype('int16')-2,0,255).astype('uint8'))
    monkeypatch.setattr(engine,'read_text',lambda *args: (_ for _ in ()).throw(AssertionError('No OCR needed')))
    assert engine.analyze(design,observed,snapshot())['issues']==[]


def test_ocr_variation_without_pixel_evidence_does_not_create_semantic_issues():
    image=Image.new('RGB',(1000,600),'white')
    issues=engine.compare_rules(image,image,snapshot(),dict(changedPercent=0,regions=[]),
        [text('Save changes'),text('Heading',y=.3)], [text('Safe changes'),text('Heading',x=.3,y=.3,h=.1)])
    assert issues==[]


def test_small_real_missing_element_is_not_hidden_by_global_similarity():
    design=Image.new('RGB',(1000,600),'white')
    ImageDraw.Draw(design).rectangle((450,250,490,275),fill='blue')
    actual=Image.new('RGB',(1000,600),'white')
    diff=engine.visual_diff(design,actual)
    assert diff['changedPercent']<1 and diff['regions']


def test_global_capture_shift_is_one_diagnostic(monkeypatch):
    design=Image.new('RGB',(1000,600),'white');actual=design.copy()
    ImageDraw.Draw(actual).rectangle((50,50,150,150),fill='red')
    expected=[text(f'Label {i}',x=.1+i*.1,y=.2) for i in range(6)]
    observed=[text(f'Label {i}',x=.1+i*.1,y=.25) for i in range(6)]
    values=iter([expected,observed]);monkeypatch.setattr(engine,'read_text',lambda image:next(values))
    result=engine.analyze(design,actual,snapshot())
    assert len(result['issues'])==1
    assert result['issues'][0]['title'].startswith('Whole-page alignment')


def test_ocr_receives_same_resolution_for_both_inputs(monkeypatch):
    design=Image.new('RGB',(2000,1200),'white');actual=Image.new('RGB',(1000,600),'white')
    ImageDraw.Draw(actual).rectangle((100,100,200,200),fill='red')
    sizes=[]
    monkeypatch.setattr(engine,'read_text',lambda image:sizes.append(image.size) or [])
    engine.analyze(design,actual,snapshot())
    assert sizes==[(1000,600),(1000,600)]
