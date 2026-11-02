"""Run local labeled comparisons; no network, telemetry, or external model service."""
import argparse
import io
import html
import platform
from importlib.metadata import version
import json
import re
from pathlib import Path
import time
from PIL import Image,ImageDraw,ImageFont
from backend.local_engine import analyze,ENGINE

ROOT=Path(__file__).resolve().parents[1]

def render(case):
    if 'reference' in case:
        base=Path(case['_base'])
        paths=[base/case[key] for key in ('reference','actual')]
        if any('://' in str(value) for value in paths):raise ValueError('Only local image files are supported.')
        with Image.open(paths[0]) as image:
            if image.width*image.height>24_000_000:raise ValueError('Reference exceeds 24 megapixels.')
            reference=image.convert('RGB')
        with Image.open(paths[1]) as image:
            if image.width*image.height>24_000_000:raise ValueError('Capture exceeds 24 megapixels.')
            actual=image.convert('RGB')
        if max(reference.width,reference.height,actual.width,actual.height)>12000 or max(reference.width*reference.height,actual.width*actual.height)>24_000_000:raise ValueError('Fixture image exceeds comparison limits.')
        snapshot=json.loads((base/case['snapshot']).read_text(encoding='utf-8')) if case.get('snapshot') else dict(url='https://benchmark.invalid',title=case['id'],width=actual.width,height=actual.height,dpr=1,scrollX=0,scrollY=0,elements=[])
        labels=case['labels']
        for label in labels:
            if label['category'] not in ('layout','missing','style','spacing','text'):raise ValueError('Unsupported label category.')
            box=label['box']
            if not (0<=box['x']<1 and 0<=box['y']<1 and box['width']>0 and box['height']>0 and box['x']+box['width']<=1.001 and box['y']+box['height']<=1.001):raise ValueError('Label box must be normalized within the image.')
        return reference,actual,snapshot,labels
    variant=case['variant'];w,h=(800,600) if variant==1 else (960,720)
    x,y=80+variant*13,130+variant*11;cw,ch=180,80
    background='#ffffff';scenario=case['scenario'];reference=Image.new('RGB',(w,h),background)
    def shape(image,box,color='#174c70'):
        draw=ImageDraw.Draw(image);draw.rectangle(box,fill=color);left,top,right,bottom=box
        draw.ellipse((left+15,top+15,left+45,top+45),fill='#64c5b5');draw.line((left+60,top+20,right-18,bottom-18),fill='#f7cc67',width=5)
    original=(x,y,x+cw,y+ch)
    text=scenario.startswith('text-')
    font=ImageFont.load_default(size=28 if variant==1 else 32)
    if text:ImageDraw.Draw(reference).text((x,y),'Continue checkout',fill='#172743',font=font)
    else:shape(reference,original)
    if scenario=='duplicate-missing':shape(reference,(x+300,y,x+300+cw,y+ch))
    actual=reference.copy();target=original
    if scenario in ('move','resize','missing','color','duplicate-missing'):
        ImageDraw.Draw(actual).rectangle(original,fill=background)
        if scenario=='move':target=(x+230,y+110,x+230+cw,y+110+ch);shape(actual,target)
        elif scenario=='resize':target=(x,y,x+cw+65,y+ch+35);shape(actual,target)
        elif scenario=='color':shape(actual,original,color='#ae2743')
    elif scenario in ('text-missing','text-change','text-move'):
        bbox=ImageDraw.Draw(reference).textbbox((x,y),'Continue checkout',font=font)
        ImageDraw.Draw(actual).rectangle((bbox[0]-2,bbox[1]-2,bbox[2]+2,bbox[3]+2),fill=background)
        target=bbox
        if scenario=='text-change':ImageDraw.Draw(actual).text((x,y),'Cancel checkout',fill='#172743',font=font)
        if scenario=='text-move':
            ImageDraw.Draw(actual).text((x+200,y+90),'Continue checkout',fill='#172743',font=font)
            target=(bbox[0]+200,bbox[1]+90,bbox[2]+200,bbox[3]+90)
    elif scenario=='minor-shift':actual=reference.transform(reference.size,Image.Transform.AFFINE,(1,0,-5,0,1,-3),fillcolor=background)
    elif scenario=='jpeg':
        buffer=io.BytesIO();actual.save(buffer,format='JPEG',quality=85);actual=Image.open(io.BytesIO(buffer.getvalue())).convert('RGB')
    elif scenario=='dpi':reference=reference.resize((w*2,h*2),Image.Resampling.LANCZOS)
    box=lambda bounds:{'x':bounds[0]/w,'y':bounds[1]/h,'width':(bounds[2]-bounds[0])/w,'height':(bounds[3]-bounds[1])/h}
    labels=[{**label,'box':box(target)} for label in case['labels']]
    snapshot=dict(url='https://synthetic.example',title=case['id'],width=w,height=h,dpr=1,scrollX=0,scrollY=0,elements=[])
    return reference,actual,snapshot,labels

def iou(a,b):
    area=max(0,min(a['x']+a['width'],b['x']+b['width'])-max(a['x'],b['x']))*max(0,min(a['y']+a['height'],b['y']+b['height'])-max(a['y'],b['y']))
    return area/max(1e-9,a['width']*a['height']+b['width']*b['height']-area)

def score(labels,predictions,threshold=.5):
    candidates=sorted([(iou(label['box'],prediction['box']),i,j) for i,label in enumerate(labels) for j,prediction in enumerate(predictions) if label['category']==prediction['category'] and iou(label['box'],prediction['box'])>=threshold],reverse=True)
    used_labels=set();used_predictions=set();matched=[]
    for value,i,j in candidates:
        if i not in used_labels and j not in used_predictions:
            used_labels.add(i);used_predictions.add(j);matched.append({'label':i,'prediction':j,'iou':round(value,4)})
    return {'tp':len(matched),'fp':len(predictions)-len(matched),'fn':len(labels)-len(matched),'matches':matched}

def metrics(rows):
    tp=sum(r['score']['tp'] for r in rows);fp=sum(r['score']['fp'] for r in rows);fn=sum(r['score']['fn'] for r in rows)
    negatives=[r for r in rows if not r['labels']]
    return dict(tp=tp,fp=fp,fn=fn,precision=round(tp/(tp+fp),4) if tp+fp else None,recall=round(tp/(tp+fn),4) if tp+fn else None,f1=round(2*tp/(2*tp+fp+fn),4) if 2*tp+fp+fn else None,negativeCases=len(negatives),negativeCaseFalseAlarmRate=round(sum(bool(r['predictions']) for r in negatives)/len(negatives),4) if negatives else None,caseErrors=sum(bool(r.get('error')) for r in rows))

def run(manifest,output,baseline=False):
    output.mkdir(parents=True,exist_ok=True);rows=[]
    ids=[case['id'] for case in manifest['cases']]
    if len(ids)!=len(set(ids)) or len(ids)>200 or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',value) for value in ids):raise ValueError('Use up to 200 unique safe case IDs.')
    for case in manifest['cases']:
        ref,actual,snapshot,labels=render(case);folder=output/case['id'];folder.mkdir(exist_ok=True)
        ref.save(folder/'reference.png');actual.save(folder/'actual.png')
        start=time.perf_counter();error=None
        try:result=analyze(ref,actual,snapshot,components=not baseline);predictions=result['issues']
        except Exception as exc:error=str(exc);predictions=[];result={}
        row={**{key:value for key,value in case.items() if key!='_base'},'labels':labels,'predictions':predictions,'score':score(labels,predictions),'seconds':round(time.perf_counter()-start,3),'error':error,'summary':result.get('summary','')}
        annotated=actual.copy();draw=ImageDraw.Draw(annotated)
        for prefix,items,color in [('E',labels,'#12803c'),('P',predictions,'#d32242')]:
            for number,item in enumerate(items,1):
                box=item['box'];left=round(box['x']*annotated.width);top=round(box['y']*annotated.height)
                draw.rectangle((left,top,round((box['x']+box['width'])*annotated.width),round((box['y']+box['height'])*annotated.height)),outline=color,width=3)
                draw.text((left,top),prefix+str(number),fill=color)
        annotated.save(folder/'labels-and-predictions.png')
        (folder/'labels-and-results.json').write_text(json.dumps(row,indent=2),encoding='utf-8');rows.append(row)
    report={'engine':ENGINE,'environment':{'python':platform.python_version(),'opencv':__import__('cv2').__version__,'pillow':version('pillow'),'rapidocr':version('rapidocr-onnxruntime')},'configuration':'OCR rules only (component matching disabled)' if baseline else 'OCR plus conservative visual components','dataset':manifest.get('description','Locally labeled dataset; review label coverage before interpreting metrics'),'iouThreshold':.5,'overall':metrics(rows),'bySplit':{split:metrics([r for r in rows if r['split']==split]) for split in ('development','holdout')},'missing':metrics([{**r,'labels':[x for x in r['labels'] if x['category']=='missing'],'predictions':[x for x in r['predictions'] if x['category']=='missing'],'score':score([x for x in r['labels'] if x['category']=='missing'],[x for x in r['predictions'] if x['category']=='missing'])} for r in rows]),'cases':rows}
    (output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    lines=['# Local comparison benchmark',report['dataset'],report['configuration'],'','| Split | TP | FP | FN | Precision | Recall | F1 | Negative case false alarms |','|---|---:|---:|---:|---:|---:|---:|---:|']
    for split,data in {'overall':report['overall'],**report['bySplit']}.items():lines.append('| '+str(split)+' | '+' | '.join(str(data[key]) for key in ('tp','fp','fn','precision','recall','f1','negativeCaseFalseAlarmRate'))+' |')
    lines+=['','Case-level evidence and labels: see report.json and each fixture directory.','Errors are reported separately and must not be interpreted as successful comparisons.','Precision uses one-to-one category + box IoU matching. Extra/duplicate findings count as false positives.','The false-alarm rate is per negative case, not a pixel or per-element specificity estimate.']
    (output/'report.md').write_text('\n'.join(lines),encoding='utf-8')
    cards=[]
    for row in rows:
        identifier=html.escape(row['id']);scores=row['score']
        cards.append(f'<section><h2>{identifier}</h2><p>TP {scores["tp"]} · FP {scores["fp"]} · FN {scores["fn"]}</p><a href="{identifier}/labels-and-results.json">Labels and findings JSON</a><div><figure><img src="{identifier}/reference.png"><figcaption>Reference</figcaption></figure><figure><img src="{identifier}/labels-and-predictions.png"><figcaption>Actual: green E = expected; red P = prediction</figcaption></figure></div><p>{html.escape(row["summary"])}</p></section>')
    document='<meta charset="utf-8"><title>Local labeled comparison benchmark</title><style>body{font:15px system-ui;max-width:1300px;margin:30px auto;padding:15px;background:#f4f5f6;color:#183e4d}section{background:white;border:1px solid #ccc;padding:16px;margin:18px 0}section div{display:flex;gap:12px}figure{margin:0;flex:1;min-width:0}img{width:100%;height:auto}pre{white-space:pre-wrap}</style><h1>Local comparison benchmark</h1><p>'+html.escape(report['dataset'])+'</p><pre>'+html.escape(json.dumps(report['overall'],indent=2))+'</pre>'+''.join(cards)
    (output/'report.html').write_text(document,encoding='utf-8');return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='artifacts/comparison-benchmark');parser.add_argument('--baseline',action='store_true');parser.add_argument('--manifest',default=str(ROOT/'benchmarks/comparison/cases.json'));args=parser.parse_args()
    manifest_path=Path(args.manifest).resolve();manifest=json.loads(manifest_path.read_text(encoding='utf-8'));
    for case in manifest['cases']:case['_base']=str(manifest_path.parent)
    report=run(manifest,Path(args.output),args.baseline)
    print(json.dumps({key:report[key] for key in ('configuration','overall','bySplit','missing')},indent=2))
    raise SystemExit(1 if report['overall']['caseErrors'] else 0)
