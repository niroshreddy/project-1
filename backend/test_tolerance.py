"""Regression cases for ordinary screenshot rendering and small spacing noise."""
import io
from pathlib import Path
import pytest
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from backend import local_engine as engine


def sample_page():
    image=Image.new('RGB',(1200,700),'white');draw=ImageDraw.Draw(image)
    font=ImageFont.load_default(size=28)
    draw.text((40,30),'About    Store',font=font,fill='#222222')
    draw.text((460,150),'Search Engine',font=ImageFont.load_default(size=48),fill='#2266ee')
    draw.rounded_rectangle((250,250,950,310),radius=28,outline='#bbbbbb',width=2)
    draw.rounded_rectangle((420,350,590,400),radius=8,fill='#f4f4f4')
    draw.text((440,360),'Search',font=font,fill='#222222')
    return image


def shift(image,x,y):
    return image.transform(image.size,Image.Transform.AFFINE,(1,0,-x,0,1,-y),fillcolor='white')


@pytest.mark.parametrize('offset',[(2,0),(0,4),(5,5),(7,-3)])
def test_small_screenshot_shifts_are_ignored(offset):
    image=sample_page()
    assert engine.visual_diff(image,shift(image,*offset))['regions']==[]


def test_jpeg_and_subpixel_rendering_are_ignored():
    image=sample_page();buffer=io.BytesIO();image.save(buffer,format='JPEG',quality=85)
    actual=Image.open(io.BytesIO(buffer.getvalue())).convert('RGB').filter(ImageFilter.GaussianBlur(.3))
    assert engine.visual_diff(image,actual)['regions']==[]


def test_minor_local_button_spacing_is_ignored():
    image=sample_page();actual=image.copy()
    patch=image.crop((415,345,600,405));ImageDraw.Draw(actual).rectangle((415,345,600,405),fill='white')
    actual.paste(patch,(421,349))
    assert engine.visual_diff(image,actual)['regions']==[]


def test_genuine_missing_button_remains_detectable():
    image=sample_page();actual=image.copy()
    ImageDraw.Draw(actual).rectangle((415,345,600,405),fill='white')
    assert engine.visual_diff(image,actual)['regions']


def test_substantial_layout_change_remains_detectable():
    image=sample_page()
    assert engine.visual_diff(image,shift(image,70,30))['regions']


def test_actual_color_change_remains_detectable():
    image=sample_page();actual=image.copy()
    ImageDraw.Draw(actual).rounded_rectangle((250,250,950,310),radius=28,fill='#d03344')
    assert engine.visual_diff(image,actual)['regions']


@pytest.mark.parametrize('variant',['shift','resize','jpeg','local-spacing','blur'])
def test_attached_google_screenshot_minor_variants(variant):
    # This personal image stays in ignored artifacts, never bundled with source.
    path=Path('artifacts/regression/google-reference.png')
    if not path.exists():
        pytest.skip('User-provided screenshot is not included in source distribution')
    image=Image.open(path).convert('RGB');actual=image.copy()
    if variant=='shift': actual=shift(image,5,4)
    if variant=='resize': actual=image.resize((image.width-12,image.height+4))
    if variant=='jpeg':
        buffer=io.BytesIO();image.save(buffer,format='JPEG',quality=85);actual=Image.open(io.BytesIO(buffer.getvalue())).convert('RGB')
    if variant=='blur': actual=image.filter(ImageFilter.GaussianBlur(.4))
    if variant=='local-spacing':
        box=(750,390,944,455);patch=image.crop(box);ImageDraw.Draw(actual).rectangle(box,fill='white');actual.paste(patch,(756,394))
    state=dict(width=image.width,height=image.height,elements=[])
    result=engine.analyze(image,actual,state)
    assert result['issues']==[],(variant,result)


def test_attached_google_missing_search_label_is_detected():
    path=Path('artifacts/regression/google-reference.png')
    if not path.exists(): pytest.skip('User screenshot not included')
    image=Image.open(path).convert('RGB');actual=image.copy()
    ImageDraw.Draw(actual).rectangle((750,390,944,455),fill='white')
    result=engine.analyze(image,actual,dict(width=image.width,height=image.height,elements=[]))
    assert result['issues'],result
