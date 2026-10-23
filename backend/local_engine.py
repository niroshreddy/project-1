"""Offline OCR and deterministic visual rules. Accepts image pixels, never URLs."""
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import lru_cache
import math
import unicodedata

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageFilter
from fastapi import HTTPException

ENGINE = 'local-rules-v3'
# Ignore small local displacements in either direction, rather than counting
# antialiased edges at their old and new coordinates as separate defects.
SPACING_TOLERANCE_CSS_PX = 8


@lru_cache(maxsize=1)
def ocr_engine():
    # This wheel ships its ONNX models. Explicit CPU paths; no fetch/download API.
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1,
                    det_limit_side_len=1280, det_limit_type='max',
                    det_use_cuda=False, cls_use_cuda=False, rec_use_cuda=False,
                    det_use_dml=False, cls_use_dml=False, rec_use_dml=False)


def normalize(text):
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in
                           unicodedata.normalize('NFKC', text).casefold()).split())


def clipped(x, y, width, height):
    left, top = max(0., min(.9999, x)), max(0., min(.9999, y))
    right, bottom = max(left+.0001, min(1., x+width)), max(top+.0001, min(1., y+height))
    return dict(x=left, y=top, width=right-left, height=bottom-top)


@dataclass
class TextRun:
    text: str
    box: dict
    confidence: float = 1.
    source: str = 'ocr'


def read_text(image):
    # Bound OCR work even for a large screenshot; coordinates stay normalized.
    image = image.copy()
    image.thumbnail((1600, 1600))
    rgb = np.asarray(image.convert('RGB'))
    results, _ = ocr_engine()(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), use_cls=False)
    runs = []
    for points, text, confidence in (results or [])[:350]:
        if confidence < .80 or len(normalize(text)) < 2:
            continue
        points = np.asarray(points)
        x, y = points.min(axis=0)
        right, bottom = points.max(axis=0)
        runs.append(TextRun(text[:140], clipped(float(x/image.width), float(y/image.height),
                    float((right-x)/image.width), float((bottom-y)/image.height)), float(confidence)))
    return sorted(runs, key=lambda run: (run.box['y'], run.box['x'], run.text))


def normalized_images(design, actual):
    # Feed OCR equally sized pixels: different DPI/resolution otherwise changes segmentation.
    factor = min(1., 1600/max(actual.size))
    size = (max(1, round(actual.width*factor)), max(1, round(actual.height*factor)))
    return (design.resize(size, Image.Resampling.LANCZOS),
            actual.resize(size, Image.Resampling.LANCZOS))


def visual_diff(design: Image.Image, actual: Image.Image, viewport_width=None) -> dict:
    if abs((design.width/design.height)/(actual.width/actual.height)-1) > .10:
        raise HTTPException(422, 'Reference and capture proportions differ by over 10%. Minor differences are normalized automatically; for this larger mismatch, crop the reference or adjust the viewport before comparing.')
    factor = min(1., 960/max(actual.size))
    size = (max(1, round(actual.width*factor)), max(1, round(actual.height*factor)))
    a = design.resize(size).filter(ImageFilter.GaussianBlur(.6))
    b = actual.resize(size).filter(ImageFilter.GaussianBlur(.6))
    pixels_a, pixels_b = np.asarray(a).astype(np.int16), np.asarray(b).astype(np.int16)
    radius = max(1, round(SPACING_TOLERANCE_CSS_PX*size[0]/(viewport_width or actual.width)))
    kernel = np.ones((2*radius+1, 2*radius+1), np.uint8)
    def residual(source, target):
        lower, upper = cv2.erode(target, kernel), cv2.dilate(target, kernel)
        return np.maximum(np.maximum(lower-source, source-upper), 0)
    delta = np.maximum(residual(pixels_a, pixels_b), residual(pixels_b, pixels_a))
    mask = (np.max(delta, axis=2) > 35).astype(np.uint8)
    # Screen-capture borders are often a few pixels different. Exclude only
    # the outer tolerance band, never whole UI sections or small isolated changes.
    edge = min(radius, max(0, min(size)//8))
    if edge:
        mask[:edge] = mask[-edge:] = 0
        mask[:, :edge] = mask[:, -edge:] = 0
    grouped = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(grouped, connectivity=8)
    regions = []
    for x, y, width, height, area in stats[1:count]:
        if area < max(12, size[0]*size[1]*.00015):
            continue
        regions.append(clipped(float(x/size[0]), float(y/size[1]), float(width/size[0]), float(height/size[1])))
    regions.sort(key=lambda box: (-box['width']*box['height'], box['y'], box['x']))
    return {'changedPercent': round(float(mask.mean())*100, 2), 'regions': regions[:60]}


def center(box):
    return box['x']+box['width']/2, box['y']+box['height']/2


def distance(a, b):
    return math.dist(center(a), center(b))


def overlap(a, b):
    intersection = max(0, min(a['x']+a['width'], b['x']+b['width'])-max(a['x'], b['x'])) * max(0, min(a['y']+a['height'], b['y']+b['height'])-max(a['y'], b['y']))
    return intersection/max(.000001, min(a['width']*a['height'], b['width']*b['height']))


def union(a, b):
    x, y = min(a['x'], b['x']), min(a['y'], b['y'])
    return clipped(x, y, max(a['x']+a['width'], b['x']+b['width'])-x,
                   max(a['y']+a['height'], b['y']+b['height'])-y)


def dom_runs(snapshot, actual_runs):
    output = list(actual_runs)
    for element in snapshot['elements']:
        text = normalize(element['text'])
        if len(text) < 3:
            continue
        # Supplement OCR, never duplicate a phrase already recognized nearby.
        if any((text in normalize(run.text) or normalize(run.text) in text) and
               overlap(element['box'], run.box) > .2 for run in actual_runs):
            continue
        output.append(TextRun(element['text'], element['box'], .99, 'dom'))
    return output[:700]


def match_text(expected, actual):
    candidates = []
    for i, ref in enumerate(expected):
        for j, live in enumerate(actual):
            a, b = normalize(ref.text), normalize(live.text)
            similarity = SequenceMatcher(None, a, b, autojunk=False).ratio()
            if a == b or (len(a) >= 5 and similarity >= .88):
                candidates.append((1-similarity + distance(ref.box, live.box)*.25, i, j, similarity))
    pairs, used_ref, used_live = [], set(), set()
    for _, i, j, similarity in sorted(candidates):
        if i not in used_ref and j not in used_live:
            pairs.append((expected[i], actual[j], similarity))
            used_ref.add(i); used_live.add(j)
    return pairs, [r for i, r in enumerate(expected) if i not in used_ref], [r for j, r in enumerate(actual) if j not in used_live]


def finding(title, category, expected, actual, explanation, recommendation, box,
            basis='possible', confidence=.65, annotation='rectangle', severity='medium'):
    return dict(title=title[:150], category=category, severity=severity, confidence=round(confidence, 2),
                expected=expected[:1000], actual=actual[:1000], explanation=explanation[:1500],
                recommendation=recommendation[:1000], annotation=annotation, box=box, basis=basis)


def compare_rules(design, actual, snapshot, diff, expected_runs, actual_runs):
    """Measured means an observed raster/geometry difference, not semantic certainty."""
    width, height = snapshot['width'], snapshot['height']
    pairs, unmatched, remaining = match_text(expected_runs, dom_runs(snapshot, actual_runs))
    issues, handled = [], []
    def changed(*boxes):
        return any(overlap(box, region) > .15 for box in boxes for region in diff['regions'])
    # Measure spacing only between neighboring, similarly sized OCR text anchors.
    anchors = [(a, b) for a, b, score in pairs if score == 1 and b.source == 'ocr']
    for ref, live in anchors:
        below = [(a, b) for a, b in anchors if .015 < a.box['y']-ref.box['y'] < .25 and
                 abs(center(a.box)[0]-center(ref.box)[0]) < .04]
        if not below:
            continue
        other, current = min(below, key=lambda pair: pair[0].box['y'])
        if any(abs(a.box['height']/b.box['height']-1) > .2 for a, b in [(ref, live), (other, current)]):
            continue
        expected_gap = (other.box['y']-ref.box['y']-ref.box['height'])*height
        actual_gap = (current.box['y']-live.box['y']-live.box['height'])*height
        if expected_gap >= 0 and actual_gap >= 0 and abs(expected_gap-actual_gap) > max(12, height*.015) and changed(ref.box, live.box, other.box, current.box):
            box = union(live.box, current.box)
            issues.append(finding('Vertical text spacing differs', 'spacing', f'Approximately {expected_gap:.0f} CSS px between recognized text regions.',
                f'Approximately {actual_gap:.0f} CSS px between recognized text regions.',
                f'Local OCR matched "{ref.text}" and "{other.text}". These are visible glyph bounds, not CSS margin measurements.',
                'Check the margins, padding, and line spacing between these elements.', box, 'measured', .83, 'measurement'))
            handled.extend([live.box, current.box])
    for ref, live, score in pairs:
        a, b = ref.box, live.box
        dx = (center(b)[0]-center(a)[0])*width
        dy = (center(b)[1]-center(a)[1])*height
        if score == 1 and live.source == 'ocr' and changed(a, b) and (abs(dx) > max(12,width*.01) or abs(dy) > max(12,height*.01)) and not any(overlap(b, box) > .6 for box in handled):
            issues.append(finding(f'Text position differs: {ref.text}', 'layout',
                f'Text center around ({center(a)[0]*width:.0f}, {center(a)[1]*height:.0f}) CSS px.',
                f'Text center around ({center(b)[0]*width:.0f}, {center(b)[1]*height:.0f}) CSS px.',
                f'The matched OCR text region is displaced by {dx:+.0f} px horizontally and {dy:+.0f} px vertically after scaling the mockup to the viewport.',
                'Check element alignment, positioning, and surrounding spacing.', b, 'measured', .85, 'arrow'))
            handled.append(b)
        if live.source == 'ocr' and changed(a, b) and abs(a['height']-b['height'])*height > 5 and max(a['height'], b['height'])/min(a['height'], b['height']) > 1.35:
            css = next((e['fontSize'] for e in snapshot['elements'] if normalize(e['text']) == normalize(live.text) and overlap(e['box'],b)>.3), None)
            issues.append(finding(f'Text size may differ: {ref.text}', 'style', f'OCR text-region height about {a["height"]*height:.0f} CSS px.',
                f'OCR text-region height about {b["height"]*height:.0f} CSS px.' + (f' Live DOM font-size: {css}.' if css else ''),
                'Recognized glyph bounds differ in height. OCR bounds cannot establish the design font size or font family.',
                'Inspect font size, font family, weight, and line height before changing CSS.', b, 'possible', .70, 'measurement'))
            handled.append(b)
    # Pair unmatched nearby OCR strings as possible text mismatches, one-to-one.
    consumed = set()
    for ref in unmatched:
        if not changed(ref.box):
            continue
        candidates = [(distance(ref.box, live.box), j, live) for j, live in enumerate(remaining)
                      if j not in consumed and live.source == 'ocr' and live.confidence >= .88 and
                      overlap(ref.box,live.box) > .25 and distance(ref.box,live.box) < .06]
        if candidates:
            _, j, live = min(candidates, key=lambda candidate: (candidate[0], candidate[1]))
            if normalize(ref.text) != normalize(live.text):
                consumed.add(j)
                issues.append(finding('Possible text mismatch', 'text', ref.text, live.text,
                    'Local OCR recognized different text in corresponding regions. Verify the screenshot because OCR can misread characters or split lines.',
                    'Compare this label with the reference and correct the text if the OCR reading is accurate.', live.box, 'possible', .72))
                handled.append(live.box)
                continue
        # OCR segmentation and missing recognition are ambiguous: never assert a missing component.
        text = normalize(ref.text)
        combined = ' '.join(normalize(run.text) for run in actual_runs)
        dom_text = ' '.join(normalize(e['text']) for e in snapshot['elements'])
        if len(text) >= 4 and ref.confidence >= .9 and text not in combined and text not in dom_text and any(overlap(ref.box, region) > .2 for region in diff['regions']):
            issues.append(finding(f'Possibly missing text: {ref.text}', 'missing', ref.text,
                'No matching OCR or supplied visible DOM text was found.',
                'The expected text overlaps changed pixels, but OCR failure, wrapping, an image, or dynamic content may explain its absence. This does not prove a component is missing.',
                'Inspect the marked location and verify whether the expected label or component is present.', ref.box, 'possible', .60, 'triangle'))
            handled.append(ref.box)
    # Report remaining image evidence without inventing component semantics.
    scaled_design = design.resize(actual.size)
    for region in diff['regions']:
        if any(overlap(region, box) > .35 for box in handled):
            continue
        crop = (int(region['x']*actual.width),int(region['y']*actual.height),
                max(1,math.ceil((region['x']+region['width'])*actual.width)),max(1,math.ceil((region['y']+region['height'])*actual.height)))
        before = np.asarray(scaled_design.crop(crop)).reshape(-1,3).mean(axis=0)
        after = np.asarray(actual.crop(crop)).reshape(-1,3).mean(axis=0)
        color = lambda values: '#'+''.join(f'{round(float(v)):02x}' for v in values)
        issues.append(finding('Visible appearance differs', 'style', f'Region mean RGB color: {color(before)}.',
            f'Region mean RGB color: {color(after)}.',
            'The blurred pixel comparison detected a changed region. Region averages include text, images, and backgrounds; they are not CSS color values. Dynamic content may account for this difference.',
            'Review colors, images, borders, and content in this region against the design.', region, 'measured', .80, severity='low'))
        if len(issues) >= 40:
            break
    # Deterministic ordering and overlapping same-category deduplication.
    output = []
    for issue in issues:
        if not any(issue['category'] == old['category'] and overlap(issue['box'],old['box'])>.8 for old in output):
            output.append(issue)
        if len(output) >= 40:
            break
    return output


def _analyze(design, actual, snapshot):
    diff = visual_diff(design, actual, snapshot['width'])
    # Identical rasters need no OCR inference and must never create semantic findings.
    if design.size == actual.size and ImageChops.difference(design, actual).getbbox() is None:
        return dict(summary='The two screenshots are identical. No visible differences were found.', issues=[], diff=diff, model=ENGINE)
    if not diff['regions']:
        return dict(summary='No visible differences exceeded the rendering-noise tolerance after matching image scale. No issues were reported.', issues=[], diff=diff, model=ENGINE)
    design, actual = normalized_images(design, actual)
    expected, observed = read_text(design), read_text(actual)
    pairs, _, _ = match_text(expected, observed)
    exact = [(a, b) for a, b, similarity in pairs if similarity == 1]
    if len(exact) >= 5:
        offsets = np.array([[(center(b.box)[0]-center(a.box)[0])*snapshot['width'],
                             (center(b.box)[1]-center(a.box)[1])*snapshot['height']] for a, b in exact])
        median = np.median(offsets, axis=0)
        consistent = np.max(np.abs(offsets-median), axis=1) < 4
        if float(consistent.mean()) >= .8 and len(exact) >= .75*max(len(expected), len(observed)) and max(abs(median)) > 12:
            issue = finding('Whole-page alignment differs; check capture setup', 'layout',
                'Reference and live page captured at the same viewport, scroll position, and crop.',
                f'Most matched text is offset about {median[0]:+.0f} CSS px horizontally and {median[1]:+.0f} CSS px vertically.',
                'A consistent page-wide shift may come from a different screenshot crop, scroll position, or viewport, or from a genuine shared layout offset. It is grouped into one finding instead of reporting each label separately.',
                'Keep DevTools in the same dock position for both captures, match the viewport and scroll position, and use a page-only screenshot. Check the shared page container if the shift remains.',
                dict(x=0., y=0., width=1., height=1.), 'measured', .9, 'arrow')
            return dict(summary='The screenshots have a consistent global alignment difference. Check the capture setup before investigating individual UI defects.', issues=[issue], diff=diff, model=ENGINE)
    issues = compare_rules(design, actual, snapshot, diff, expected, observed)
    possible = sum(issue['basis']=='possible' for issue in issues)
    summary = f'Local comparison found {len(issues)} findings: {len(issues)-possible} measured differences and {possible} possible issues. OCR read {len(expected)} reference and {len(observed)} live text regions. Review OCR matches and dynamic content; rule confidence is a heuristic, not an accuracy probability.'
    if not expected or not observed:
        summary += ' Little or no text was recognized in one image; text and missing-element checks are limited.'
    if len(issues) == 40 or len(diff['regions']) == 60:
        summary += ' Results are capped; additional differences may exist.'
    return dict(summary=summary, issues=issues, diff=diff, model=ENGINE)


def analyze(design, actual, snapshot):
    result = _analyze(design, actual, snapshot)
    difference = abs((design.width/design.height)/(actual.width/actual.height)-1)
    if difference > .01:
        result['summary'] += f' Screenshot proportions differed by {difference*100:.1f}% and were automatically normalized. Size and spacing findings may reflect this adjustment; review them before changing the page.'
    return result
