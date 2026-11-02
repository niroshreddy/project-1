"""Conservative local rectangular-region matching, without semantic component claims."""
import math
import cv2
import numpy as np
from PIL import Image


def intersection(a,b):
    return max(0,min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0]))*max(0,min(a[1]+a[3],b[1]+b[3])-max(a[1],b[1]))

def iou(a,b):
    area=intersection(a,b)
    return area/max(1,a[2]*a[3]+b[2]*b[3]-area)

def regions(image):
    # Bounded processing on the same canvas used by the OCR rules.
    rgb=np.asarray(image.convert('RGB'))
    edges=cv2.Canny(cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY),35,100)
    contours,_=cv2.findContours(edges,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
    candidates=[];w,h=image.size
    for contour in contours:
        x,y,width,height=cv2.boundingRect(contour)
        if width<24 or height<18 or width*height<max(600,w*h*.0008) or width*height>w*h*.18:continue
        if x<2 or y<2 or x+width>w-2 or y+height>h-2:continue
        if cv2.contourArea(contour)/(width*height)<.85:continue
        approx=cv2.approxPolyDP(contour,cv2.arcLength(contour,True)*.025,True)
        if len(approx)!=4 or not cv2.isContourConvex(approx):continue
        box=(int(x),int(y),int(width),int(height))
        if any(iou(box,old)>.8 for old in candidates):continue
        candidates.append(box)
    return sorted(candidates,key=lambda b:(-b[2]*b[3],b[1],b[0]))[:100]

def descriptor(image,box):
    x,y,w,h=box
    return np.asarray(image.crop((x+2,y+2,x+w-2,y+h-2)).resize((40,32),Image.Resampling.BILINEAR),dtype=np.float32)/255

def matches(design,actual,snapshot,tolerance=8):
    """Only distinctive reciprocal matches can produce movement/size findings.

    Repeated/ambiguous regions abstain. A removed region is a *possible* missing
    visual region only if no similar candidate or retained same-position shape exists.
    """
    refs,live=regions(design),regions(actual)
    if not refs:return []
    a=[descriptor(design,b) for b in refs];b=[descriptor(actual,r) for r in live]
    scores=np.array([[float(np.abs(x-y).mean()) for y in b] for x in a]) if live else np.empty((len(refs),0))
    width,height=snapshot['width'],snapshot['height'];sx,sy=width/design.width,height/design.height
    def normalized(box):return dict(x=box[0]/design.width,y=box[1]/design.height,width=box[2]/design.width,height=box[3]/design.height)
    output=[]
    for i,ref in enumerate(refs):
        order=np.argsort(scores[i]) if live else []
        best=int(order[0]) if len(order) else None
        if best is not None and scores[i,best]<.045:
            # Duplicate appearance is intrinsically ambiguous, even at distant positions.
            row=sorted(scores[i]);column=sorted(scores[:,best])
            unique=(len(row)<2 or row[1]-row[0]>.012) and (len(column)<2 or column[1]-column[0]>.012)
            if not unique or int(np.argmin(scores[:,best]))!=i:continue
            target=live[best]
            dx=((target[0]+target[2]/2)-(ref[0]+ref[2]/2))*sx
            dy=((target[1]+target[3]/2)-(ref[1]+ref[3]/2))*sy
            dw=(target[2]-ref[2])*sx;dh=(target[3]-ref[3])*sy
            resized=max(abs(dw),abs(dh))>max(12,tolerance*1.5) and max(abs(target[2]/ref[2]-1),abs(target[3]/ref[3]-1))>.15
            anchored=max(abs(target[0]-ref[0])*sx,abs(target[1]-ref[1])*sy)<=max(12,tolerance*1.5)
            if resized and anchored:
                output.append(dict(kind='size',reference=normalized(ref),actual=normalized(target),detail=f'Visually similar bounded regions differ in size by {dw:+.0f} × {dh:+.0f} CSS px.'))
            elif max(abs(dx),abs(dy))>max(12,tolerance*1.5):
                output.append(dict(kind='layout',reference=normalized(ref),actual=normalized(target),detail=f'Visually similar bounded regions have centers displaced by {dx:+.0f} × {dy:+.0f} CSS px.'))
            elif resized:
                output.append(dict(kind='size',reference=normalized(ref),actual=normalized(target),detail=f'Visually similar bounded regions differ in size by {dw:+.0f} × {dh:+.0f} CSS px.'))
            continue
        # A retained shape with a new color/content is appearance change, not disappearance.
        if any(iou(ref,target)>.45 for target in live):continue
        if best is not None and scores[i,best]<.075:continue
        x,y,w,h=ref
        patch=np.asarray(actual.crop((x+2,y+2,x+w-2,y+h-2)),dtype=np.float32)
        # Only a near-uniform replacement supports a disappearance hypothesis.
        if float(patch.std(axis=(0,1)).mean())>9:continue
        before=np.asarray(design.crop((x+2,y+2,x+w-2,y+h-2)),dtype=np.float32)
        if float(np.abs(before.mean(axis=(0,1))-patch.mean(axis=(0,1))).mean())<40:continue
        output.append(dict(kind='missing',reference=normalized(ref),actual=normalized(ref),detail='A bounded reference region has no distinctive visual match; its former location is now near-uniform.'))
    return output[:25]
