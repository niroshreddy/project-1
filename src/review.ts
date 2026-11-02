import type { Comparison, Issue } from './types';
export function issueKey(issue:Issue) {
  return JSON.stringify([issue.category,issue.title,issue.expected,issue.actual,
    ...['x','y','width','height'].map(key=>Math.round(issue.box[key as keyof Issue['box']]*100))]);
}
export function carryReview(current:Comparison,baseline:Comparison):Comparison {
  const compatible=current.capture.snapshot.url===baseline.capture.snapshot.url&&current.design.image===baseline.design.image&&current.capture.snapshot.width===baseline.capture.snapshot.width&&current.capture.snapshot.height===baseline.capture.snapshot.height;
  if(!compatible)throw new Error('Verification requires the same URL, reference image and capture dimensions as the baseline.');
  return {...current,baselineId:baseline.id,issues:current.issues.map(issue=>{
    const previous=baseline.issues.find(old=>issueKey(old)===issueKey(issue));
    return previous?.review?.status==='accepted'?{...issue,dismissed:true,review:previous.review}:previous?.review?{...issue,review:{...previous.review,status:'open',updatedAt:new Date().toISOString()}}:issue;
  }),verification:baseline.issues.filter(issue=>issue.review?.status!=='accepted'&&!issue.dismissed).map(issue=>{
    const match=current.issues.find(next=>issueKey(next)===issueKey(issue));
    return {previousIssue:issue.title,outcome:match?'still-detected':'not-detected',currentIssueId:match?.id};
  })};
}
export function issueText(record:Comparison,issue:Issue) {
  const box=issue.box,w=record.capture.snapshot.width,h=record.capture.snapshot.height;
  return `${issue.title}\n\nURL: ${record.capture.snapshot.url}\nCapture: ${w} × ${h} CSS px; ${record.capture.capturedAt}\nArea: x=${Math.round(box.x*w)}, y=${Math.round(box.y*h)}, width=${Math.round(box.width*w)}, height=${Math.round(box.height*h)} CSS px\nEvidence: ${issue.basis??'legacy'} (raster bounds, not CSS measurements)\nExpected: ${issue.expected}\nActual: ${issue.actual}\n${issue.explanation}\nSuggested fix: ${issue.recommendation}\nOwner: ${issue.review?.owner||'Unassigned'}\nImpact: ${issue.review?.impact||'Unspecified'}\nReview: ${issue.review?.status??'open'}\n${issue.review?.comment??''}`;
}
