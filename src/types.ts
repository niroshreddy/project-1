export type Box = { x: number; y: number; width: number; height: number };
export type Issue = {
  id: string; title: string; category: 'missing' | 'text' | 'layout' | 'spacing' | 'style';
  severity: 'high' | 'medium' | 'low'; confidence: number;
  expected: string; actual: string; explanation: string; recommendation: string;
  annotation: 'rectangle' | 'arrow' | 'triangle' | 'measurement'; box: Box; dismissed?: boolean;
  basis?: 'measured' | 'possible';
};
export type ElementInfo = { tag: string; text: string; box: Box; fontSize: string; fontFamily: string; color: string; background: string; display: string; gap: string; padding: string };
export type Snapshot = { url: string; title: string; width: number; height: number; dpr: number; scrollX: number; scrollY: number; elements: ElementInfo[] };
export type Capture = { image: string; snapshot: Snapshot; capturedAt: string };
export type Design = { image: string; name: string; width: number; height: number };
export type Diff = { changedPercent: number; regions: Box[] };
export type Comparison = { id: string; createdAt: string; capture: Capture; design: Design; diff: Diff; issues: Issue[]; summary: string; model: string };
