import type { Capture, Comparison, Design, Issue } from './types';
export function exportCapture(capture: Capture) {
  const link = document.createElement('a');
  link.href = capture.image; link.download = capture.snapshot.fullPage ? 'project-1-full-page.png' : 'project-1-viewport.png'; link.click();
}
export function imageFrom(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Unable to decode image.')); image.src = source; });
}
export async function rasterize(source: string, name: string): Promise<Design> {
  const image = await imageFrom(source);
  if (image.width * image.height > 24_000_000 || Math.max(image.width, image.height) > 12000) throw new Error('Choose an image under 24 megapixels and 12,000 pixels per side.');
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
  return { name, image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
export const ANNOTATION_COLORS = {border:'#e52d43',fill:'#e52d430b',selectedFill:'#e52d4330',marker:'#d62139',markerText:'#ffffff'} as const;
export function visibleIssues(record: Comparison): Issue[] { return record.issues.filter(issue => !issue.dismissed); }
export async function annotated(record: Comparison, selected?: string): Promise<HTMLCanvasElement> {
  const image = await imageFrom(record.capture.image);
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
  const scale = Math.max(1, image.width / record.capture.snapshot.width);
  record.issues.forEach((issue, index) => {
    if (issue.dismissed) return;
    const x = issue.box.x * canvas.width, y = issue.box.y * canvas.height;
    const w = issue.box.width * canvas.width, h = issue.box.height * canvas.height;
    ctx.strokeStyle = '#e52d43'; ctx.fillStyle = selected === issue.id ? '#e52d4330' : '#e52d430b'; ctx.lineWidth = (selected === issue.id ? 3 : 2) * scale;
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    if (issue.annotation === 'triangle') {
      ctx.beginPath(); ctx.moveTo(x + w/2, y + 5*scale); ctx.lineTo(x+w/2-8*scale, y+20*scale); ctx.lineTo(x+w/2+8*scale, y+20*scale); ctx.closePath(); ctx.stroke();
    } else if (issue.annotation === 'arrow') {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+w/2, y+h/2); ctx.lineTo(x+w/2-9*scale,y+h/2-2*scale); ctx.moveTo(x+w/2,y+h/2); ctx.lineTo(x+w/2-2*scale,y+h/2-9*scale); ctx.stroke();
    } else if (issue.annotation === 'measurement') {
      const middle = y+h/2; ctx.beginPath(); ctx.moveTo(x,middle); ctx.lineTo(x+w,middle);
      ctx.moveTo(x,middle-7*scale); ctx.lineTo(x,middle+7*scale); ctx.moveTo(x+w,middle-7*scale); ctx.lineTo(x+w,middle+7*scale); ctx.stroke();
    }
    const cx = Math.min(canvas.width-13*scale, Math.max(13*scale,x+12*scale));
    const cy = Math.min(canvas.height-13*scale, Math.max(13*scale,y+12*scale));
    ctx.fillStyle = '#d62139'; ctx.beginPath(); ctx.arc(cx,cy,11*scale,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'white'; ctx.font = `bold ${12*scale}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(index+1),cx,cy);
  });
  return canvas;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function exportPng(record: Comparison) {
  const canvas = await annotated(record);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed.')), 'image/png'));
  download(blob, 'project-1-annotated.png');
}
export async function exportPdf(record: Comparison) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF(); let y = 20;
  const line = (text: string, size = 10) => {
    pdf.setFontSize(size);
    // Built-in PDF font supports Latin text; replace unsupported glyphs rather than corrupting output.
    const lines: string[] = pdf.splitTextToSize(text.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?'), 176);
    for (const textLine of lines) { if (y > 275) { pdf.addPage(); y=20; } pdf.text(textLine,17,y); y += size*.48; }
    y += 4;
  };
  line('project-1 / UI validation report', 20);
  line(`Captured: ${new Date(record.capture.capturedAt).toLocaleString()}`);
  line(`URL: ${record.capture.snapshot.url}`);
  line(`${record.capture.snapshot.fullPage ? 'Full page' : 'Viewport'}: ${record.capture.snapshot.width} x ${record.capture.snapshot.height} CSS px | Engine: ${record.model}`);
  if(record.options) line(`Comparison settings: tolerance ${record.options.tolerancePx} CSS px; ${record.options.normalization==='fit'?'fit reference to capture':'exact pixel dimensions'}.`);
  line(`${visibleIssues(record).length} active findings; ${record.issues.filter(i => i.dismissed).length} dismissed. Pixel change: ${record.diff.changedPercent}% (not an accuracy score).`);
  line(record.summary);
  if(record.approval) line(`Review decision: ${record.approval.status}; reviewer: ${record.approval.reviewer}; note: ${record.approval.note}`);
  if(record.options?.alignment) line(`Reference alignment: x ${record.options.alignment.x}px; y ${record.options.alignment.y}px; scale ${record.options.alignment.scale}.`);
  if(record.verification) for(const check of record.verification) line(`Verification: ${check.previousIssue} - ${check.outcome}. Not detected requires visual confirmation.`);
  for (const [label, source] of [['Expected design', record.design.image], ['Annotated page', (await annotated(record)).toDataURL('image/png')]]) {
    const image = await imageFrom(source);
    const sliceHeight = Math.max(1, Math.floor(image.width*236/176));
    const parts = Math.ceil(image.height/sliceHeight);
    for (let part=0;part<parts;part++) {
      pdf.addPage(); y=20; line(`${label}${parts>1 ? ` (${part+1}/${parts})` : ''}`,16);
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=Math.min(sliceHeight,image.height-part*sliceHeight);
      canvas.getContext('2d')!.drawImage(image,0,part*sliceHeight,image.width,canvas.height,0,0,image.width,canvas.height);
      pdf.addImage(canvas.toDataURL('image/png'),'PNG',17,y,176,canvas.height*176/image.width);
    }
  }
  pdf.addPage(); y=20; line('Findings',18);
  if (!visibleIssues(record).length) line('No active findings. This does not guarantee pixel-perfect compliance.');
  record.issues.forEach((issue,index) => {
    if (y>215) { pdf.addPage(); y=20; }
    line(`${index+1}. ${issue.title} [${issue.severity}; confidence ${Math.round(issue.confidence*100)}%]`,12);
    line(`Evidence: ${issue.basis ?? 'legacy'}. Confidence is heuristic. Category: ${issue.category}. Location: ${Math.round(issue.box.x*100)}%, ${Math.round(issue.box.y*100)}% of captured page.`);
    if(issue.review) line(`Review: ${issue.review.status}; owner: ${issue.review.owner||'unassigned'}; impact: ${issue.review.impact}; note: ${issue.review.comment}`);
    line(`Expected: ${issue.expected}`); line(`Actual: ${issue.actual}`);
    line(issue.explanation); line(`Recommendation: ${issue.recommendation}`);
  });
  if(record.knowledge){
    const trace=record.knowledge;pdf.addPage();y=20;line('Project Knowledge + Traceability',18);line(`Project: ${trace.project.name}; trace: ${trace.id}; comparison: ${trace.comparisonId}`);line(`Capture: ${trace.capture.capturedAt}; ${trace.capture.device}; design reference match: ${trace.referenceMatch}`);
    for(const source of trace.sources)line(`Source ${source.id}: ${source.title} / ${source.version}; approved by ${source.approved_by} at ${source.approved_at}; SHA-256 ${source.hash}`);
    if(!trace.checks.length)line('No approved explicit rules were evaluated. No compliance conclusion.');
    for(const check of trace.checks){line(`${check.title}: ${check.status} / ${check.obligation}`,12);line(`Rule ${check.ruleId}; source ${check.sourceId}; expected: ${check.expected}`);line(`Observed: ${check.observed}; evidence: ${check.evidenceIds.join(', ')||'No matched sample'}`);}
    line(`Explanation mode: ${trace.advice.mode}`);line(trace.advice.answer);
    for(const item of trace.advice.recommendations){line(item.title,12);line(item.explanation);line(item.recommendation);line(`Source citations: ${item.sourceIds.join(', ')}; evidence: ${item.evidenceIds.join(', ')}`);}
    for(const link of trace.visualLinks)line(`Human association (not proof): visual finding ${link.issueId} -> rule ${link.ruleId}`);
    for(const limit of [...trace.limitations,...trace.advice.uncertainties])line(limit);
    line('Download the JSON evidence trace for the full frozen source, rule and DOM measurement snapshots.');
  }
  download(pdf.output('blob'), 'project-1-report.pdf');
}
