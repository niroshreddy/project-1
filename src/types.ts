import type {KnowledgeTrace} from './knowledge';
export type Box = { x: number; y: number; width: number; height: number };
export type Issue = {
  id: string; title: string; category: 'missing' | 'text' | 'layout' | 'spacing' | 'style';
  severity: 'high' | 'medium' | 'low'; confidence: number;
  expected: string; actual: string; explanation: string; recommendation: string;
  annotation: 'rectangle' | 'arrow' | 'triangle' | 'measurement'; box: Box; dismissed?: boolean;
  basis?: 'measured' | 'possible';
  review?: {status:'open'|'accepted'|'fixed';owner:string;impact:string;comment:string;updatedAt:string};
};
export type ElementInfo = { tag: string; text: string; box: Box; fontSize: string; fontFamily: string; color: string; background: string; display: string; gap: string; padding: string };
export type Snapshot = { url: string; title: string; width: number; height: number; viewportWidth?: number; viewportHeight?: number; fullPage?: boolean; dpr: number; scrollX: number; scrollY: number; elements: ElementInfo[]; quality?: {ready:boolean;pendingImages:number;brokenImages:number;fontsReady:boolean;layoutStable:boolean;warnings:string[]} };
export type Capture = { preview?:{ownerTabId:number;tabId:number;sessionId:string;width:number;height:number;presetId:string;orientation:'portrait'|'landscape'}; device?:{mode:'desktop'|'mobile';width:number;height:number;presetId?:string;orientation?:'portrait'|'landscape'}; image: string; snapshot: Snapshot; capturedAt: string };
export type Design = { image: string; name: string; width: number; height: number };
export type Diff = { changedPercent: number; regions: Box[] };
export type ComparisonOptions = { tolerancePx: number; normalization: 'fit' | 'strict'; alignment?: {x:number;y:number;scale:number} };
export type Comparison = { knowledge?:KnowledgeTrace; id: string; createdAt: string; capture: Capture; design: Design; diff: Diff; issues: Issue[]; summary: string; model: string; sourceDesign?:Design; options?: ComparisonOptions; baselineId?:string; pinned?:boolean; verification?:{previousIssue:string;outcome:'still-detected'|'not-detected';currentIssueId?:string}[]; approval?:{status:'draft'|'changes-requested'|'approved';reviewer:string;note:string;updatedAt:string} };
