# Feature design, extraction and learned weights

This is the experimental feature branch. It keeps the MIT core, changes the demo/server inference route and provides a generic classifier workflow. It does not require a specific number of dimensions. The eight dialogue outputs are policy targets, not a restriction to eight features.

## 1. Prepare labels and split groups first

Use your own licensed dataset with human or independently verified labels. Group correlated examples by respondent, session, source document or conversation family before partitioning them. All members of a group must stay in one split. Exact repeated inputs must be deduplicated; event IDs, camera timestamps and teacher labels do not change the input digest. Different paraphrases need the same family group if they are closely related.

Input JSONL has one object per line:

```json
{"id":"example-001","group":"fictional-session-a","split":"train","input":{"turns":[{"id":"u1","role":"user","text":"架空の正解付き発言をここへ置きます。"}]},"labels":{"result":"class_a"}}
```

`split` is `train`, `validation` or `test`. An answer task also has the complete server-owned `question` in `input`; context data can include only the fixed `camera` observation, never raw image bytes. Runtime inputs do not contain labels. A cache row retains IDs, group, split, a SHA-256 input digest, labels and numeric features, and omits raw transcripts. A weighted model contains definitions, labels, numerical parameters and aggregate validation counts, not the input transcripts or API keys.

The code offers `splitGroups(rows, seed)` for deterministic 60/20/20 group partitioning. Check class support after splitting: every class needs at least two training rows and one validation row. Every split must exist. Small datasets can be rejected instead of silently recycling test data.

Keep real JSONL, caches, manifests containing confidential task descriptions and fitted models outside the public checkout. For each external dataset, record its source, license, label definition and grouping rule yourself. This repository ships only original fictional fixtures; it downloads no dataset automatically.

## 2. Ask an LLM to propose dimensions

Create a task JSON:

```json
{
  "id":"example_features",
  "description":"Describe the task and the observable traits that could distinguish its classes.",
  "jevModel":"jev-1.13.0",
  "targets":[{"id":"result","labels":["class_a","class_b"],"basis":"respondent_words"}]
}
```

Build, then use the optional Gemini designer with your own key and an available model:

```sh
npm run build
node scripts/features.mjs design --live --task lab/task.json --data lab/labelled.jsonl --llm-model YOUR_AVAILABLE_MODEL --out lab/proposal.json
```

`GEMINI_API_KEY` is read from your server environment. No environment file is loaded automatically. The prompt serializes at most 24 bounded **training** examples with their labels; validation and test examples are filtered before serialization. The LLM decides the number of dimensions and their ordered rubrics. It returns a proposal, which must be reviewed for atomic measurable traits, leakage, redundant dimensions and disguised final-label questions before extraction. This is a semantic review, not a claim that JSON validation can detect every bad feature. Freeze that choice before evaluating test data. For another LLM, supply a `DimensionDesigner` callback to `proposeDimensions`.

A manifest looks like this:

```json
{
  "version":1,"id":"example_features","task":"Your observable-feature task",
  "jevModel":"jev-1.13.0",
  "designer":{"kind":"llm","model":"your-designer-model","scope":"training-only"},
  "dimensions":[{
    "id":"concrete_example","label":"Concrete example",
    "basis":"respondent_words",
    "instructions":"Measure whether the respondent supplies a specific example or condition, rather than a general statement.",
    "criteria":["No example","Vague example","Explicit concrete example"]
  }]
}
```

Use `camera_observation` only for capture/material/observable shape features. Answer models reject camera dimensions. Dialogue word features and camera features are extracted in separate Jev calls with separate states; the word call has no camera, and the camera call has no transcript. Target `basis` masks learned weights: mismatched dimensions must have weight zero. For generic text classifiers, use `respondent_words`.

## 3. Extract features without labels

```sh
node scripts/features.mjs extract --live --manifest lab/proposal.json --data lab/labelled.jsonl --out lab/cache.jsonl
```

Requires your own `TYPESAFE_API_KEY`. The explicit `--live` flag enables paid provider calls; the default demo performs none. All rows are checked for exact duplicates and group overlap before extraction begins. The CLI then sends only constructed inputs to Jev. Teacher labels and dataset metadata never enter the request. There is no production-data import or automatic dataset search.

Each atomic feature uses Jev's `score` question with 2–10 ordered criteria. Its expected rubric index is divided by the maximum index to produce a value in [0,1]. The response parser also checks the complete level distribution, expected value, exact legend, fixed model version and usage. Distribution width and Jev confidence remain diagnostics, separate from the downstream candidate score. The current learner uses normalized means; it does not learn from the uncertainty columns.

Feature vectors and weights use an exact canonical schema identity, including instructions, basis, dimension/rubric order and pinned Jev model. It is a compatibility identity, not a cryptographic signature. Changing any of these requires new extraction and fitting. Scripted demo features carry `source: "scripted"` and cannot be mixed with actual Jev features or used to start a live survey handler.

## 4. Fit, choose, then evaluate

```sh
node scripts/features.mjs train --manifest lab/proposal.json --task lab/task.json --cache lab/cache.jsonl --out lab/model.json
# After selecting the final definitions and settings:
node scripts/features.mjs evaluate --model lab/model.json --cache lab/cache.jsonl --out lab/test-report.json
```

Outputs never overwrite existing files. Training computes means and scales from training rows only. Each target is a class-balanced multiclass logistic model fitted by deterministic gradient descent, with signed weights, a bias per class and L2 regularization. Without `--l2`, three predefined L2 candidates are selected by validation log loss; a fixed `--l2 0.025` can be used for a controlled experiment. The acceptance threshold is selected on validation using a minimum sample count and precision target; it also requires a score margin. If no threshold qualifies, the model abstains.

For class c: `logit[c] = bias[c] + Σ weight[c,j] × ((feature[j] - train_mean[j]) / train_scale[j])`. A softmax of all class logits yields candidate scores. Contributions sum to the logit, not to a percentage. These scores and validation thresholds are experimental; they are not certified probabilities of correctness, and they do not guarantee precision on a new population.

`train` returns validation metrics only. `evaluate` is a separate read-only operation on the final frozen model and the test split. It cannot change weights, regularization, thresholds or scaling. Do not repeatedly adjust features or settings after reading test results; choose new held-out data for another experiment. Reports give raw top-class accuracy, log loss, class support, accepted coverage and accepted accuracy. Report both accuracy and coverage; abstention does not turn into an invented answer.

The offline demo learns real numerical weights from scripted fictional measurements. Its final-test button freezes the controls for that browser experiment. Repeated fictional templates intentionally test the calculation contract and UI, not generalization. Neither 52% nor 87.61% has been reproduced, and no live Jev accuracy is measured here.

## 5. Use the survey targets

`answerTargets(question)` returns the exact labels needed by the survey mapper. Single/scale targets contain the option/level IDs and four reserved states. Multiple/text targets use readiness; multiple choice also has one `yes`/`no` target per option. Label readiness and every option separately in a multiple-choice training row. `contextTargets()` supplies all eight existing dialogue target label lists and evidence boundaries. The runtime preserves no-answer, insufficient-information and decline states; an ambiguous prediction stays pending. Free text copies the latest respondent words exactly after readiness is accepted. Nothing is automatically confirmed.

Build one model for every server-owned question and one for context. For CLI bundling, provide your survey JSON and a paths JSON:

```json
{"questions":{"schedule":"lab/schedule-model.json","activities":"lab/activities-model.json","pace":"lab/pace-model.json","idea":"lab/idea-model.json"},"context":"lab/context-model.json"}
```

```sh
node scripts/features.mjs bundle --survey lab/survey.json --models lab/model-paths.json --out lab/feature-bundle.json
```

The feature handler rejects incomplete bundles, changed question definitions, different target order/labels, nonzero cross-basis weights and scripted sources. Load the frozen bundle on your server; do not accept arbitrary client weights or features. `FEATURE_BUNDLE=lab/feature-bundle.json VOICE_SURVEY_LIVE=1 npm run demo` starts the loopback development example using your own environment keys. Its lack of shared authentication makes it a local example; a hosted app supplies authorization and budget callbacks.

The reusable generic learner can also explore Claude/GPT classification using a suitable licensed dataset, an atomic linguistic feature proposal and independently verified source labels. That experiment and its claimed accuracy are not included in the survey demo.
