# Local labeled comparison benchmark

Run from the repository root with installed local OCR dependencies:

```powershell
.\.venv\Scripts\python.exe -m backend.comparison_benchmark --baseline --output artifacts/comparison-benchmark-baseline
.\.venv\Scripts\python.exe -m backend.comparison_benchmark --output artifacts/comparison-benchmark-current
```

Open each output's `report.html` for reference/actual images with expected green boxes and predicted red boxes. `report.json` contains predictions, timings, labels, matching details and metrics; `report.md` is a compact summary. Every case gets raw images, an annotated image and labels/results JSON. Everything runs locally with packaged OCR; there are no model-service or website requests.

## What is labeled

`cases.json` defines 24 deterministic synthetic cases before detector execution. Eight are negative controls: identical, minor shift, JPEG and different-DPI reference, each at two parameter variants. Sixteen positive cases cover movement, anchored resize, disappearance, color change, ambiguous repeated regions, missing text, changed text and moved text. Ground-truth boxes are derived from the known drawing coordinates, not detector output. No third-party images or customer data are included.

The split names are development and holdout, but holdout is only a second parameter variant of the same rendering templates. It was inspected during development and is **not blind or independent validation**. Neither split establishes production accuracy, user acceptance or performance on arbitrary sites. Add human-labeled real pairs before drawing adoption or quality conclusions.

## Scoring

A prediction matches one label only when its category agrees and normalized box intersection-over-union is at least 0.5. Matching is greedy by descending IoU and one-to-one. Extra and duplicate findings count as false positives; unmatched labels count as false negatives. Precision = TP/(TP+FP); recall = TP/(TP+FN). Undefined denominators are JSON null. The negative-case false-alarm rate counts negative cases with any prediction; it is not per-pixel or per-component specificity. Runtime failures are separately counted, produce no predictions and retain their missing labels; any case error causes nonzero command exit. Dataset/render validation errors stop the command rather than produce a misleading successful report.

Baseline disables only the new visual-component matcher in the current engine; it is an ablation, not a frozen historical executable. Both configurations use the same OCR and image-difference code and fixture labels. Component findings are possible issues, even when a synthetic expected box matches. Confidence values are not probabilities.

## Add independently labeled real pairs

Use a local JSON manifest and keep source images beside it:

```json
{
  "version": 1,
  "description": "Human-reviewed checkout pairs; specify reviewer and collection protocol here",
  "cases": [{
    "id": "checkout-mobile-001",
    "split": "holdout",
    "reference": "reference.png",
    "actual": "actual.png",
    "labels": [{"id": "missing-continue", "category": "missing", "box": {"x": 0.1, "y": 0.7, "width": 0.5, "height": 0.1}}]
  }]
}
```

```powershell
.\.venv\Scripts\python.exe -m backend.comparison_benchmark --manifest path/to/manifest.json --output artifacts/customer-benchmark
```

Optionally set `snapshot` to a local snapshot JSON file with the actual captured DOM/CSS evidence; otherwise the runner supplies image dimensions and no DOM. Paths resolve relative to the manifest. Labels use actual-image normalized coordinates and categories `missing`, `layout`, `style`, `text`, or `spacing`. For a missing item, label where it should appear; for movement/resize label the actual affected item. Reviewers should annotate all meaningful differences at the configured 8px tolerance, include unchanged negatives, adjudicate disagreements, and freeze a genuinely separate validation set before tuning. Remove private screenshot information before retaining/sharing datasets.

## Current limitations

The component matcher proposes rectangular visual regions, not semantic React/HTML identities. It normalizes RGB patches, requires distinctive reciprocal matches and abstains on repeated appearances. It can suggest movement, anchored size changes and disappearance into near-uniform background. Borderless imagery, irregular icons, nested components, occlusion, complex backgrounds, changed content and similar-looking controls can be missed. Missing duplicate controls are intentionally not assigned an identity. OCR can still produce redundant generic appearance findings around a text change. Benchmark labels and all flagged regions need human review.
