# lathe_landscape — loss-landscape fingerprints (LATHE)

A standalone repo and static site for measuring the **loss landscape** of trained classifiers (here, the BCE + $\alpha\,$DisCo LLP networks) and comparing those measurements across loss settings, seeds and architectures.

A **fingerprint** is a fixed set of geometric measurements taken at fixed points in training (and/or on a saved checkpoint), always on the same held-out *probe batch*:

| Probe | What it measures | Hypothesis it serves |
|---|---|---|
| per-layer gradient conflict | direction $c_\ell = \cos(\nabla\text{BCE}, \nabla\text{DisCo})$, balance $\rho_\ell = \alpha\lVert\nabla\text{DisCo}\rVert/\lVert\nabla\text{BCE}\rVert$, cancellation $\kappa_\ell = \lVert\nabla\text{BCE} + \alpha\nabla\text{DisCo}\rVert/(\lVert\nabla\text{BCE}\rVert + \alpha\lVert\nabla\text{DisCo}\rVert)$ | H2: pinch-point candidates (stalls during training); see the site's Info page for validity |
| Hessian spectrum ends | $\lambda_{\max}$, $\lambda_{\min}$ by (shifted) power iteration; $\operatorname{tr}H$ by Hutchinson | H1/H3: sharpness, negative curvature, the early spike |
| 1-D filter-normalized slices | $L(\theta + a\,d) - L(\theta)$ (Li et al. 2018): rise, width, roughness | H1: basin shape vs $\alpha$ |
| seed-pair interpolation | $\max_t\,[L(t) - \text{chord}]$ between two seeds; prediction distance | H4: is a degraded seed in a separate basin? |
| dCor gap | mean minibatch dCor² vs full-sample dCor² on background | is DisCo optimizing a biased version of the target? |

Final losses are recorded too, but they are tagged `loss_*` and kept **out** of the kill-test features by default: "the final DisCo value predicts closure" is known and not a landscape finding.

## Layout

```
lfp/                     the library (no dependency on your training code)
  adapter.py             RunHandle: the contract between your code and the probes
  probes/                conflict (c, rho, kappa) | curvature | slices | pairs | dcor | snapshot
  recorder.py            training-time hook (records at chosen epochs)
  summary.py             fingerprints -> one row per run
  site_build.py          writes the static site + data bundle
  killtest.py            exploratory kill-test preview
  cli.py                 python -m lfp (or `lfp`) probe | pairs | build-site | killtest
  site/                  explorer template: index.html (fingerprints), info.html (pinch-point validity)
adapters/TEMPLATE.py     copy and fill for your runs
docs/
  DESIGN_HISTORY.md      how this repo came about: reasoning, decisions, corrections, open items
  BASE_RUN_PLAN.md       how big a run has to be before comparisons mean anything
  img/                   site screenshots used by the docs
tests/                   analytic correctness tests of the probes
examples/smoke_sklearn/  end-to-end smoke test on a real public table (delete any time)
index.html, assets/      public home page (GitHub Pages root): definitions, hypothesis sketches, status
explorer/                published explorer build (created by build-site --out explorer; commit it)
```

Start with [docs/DESIGN_HISTORY.md](docs/DESIGN_HISTORY.md) for the why; this README is the how.

## Install

```powershell
python -m venv .venv ; .venv\Scripts\activate
pip install -e .                     # or: pip install -r requirements.txt
python -m pytest -q                  # 9 analytic checks (or: python tests\test_probes.py)
python examples\smoke_sklearn\run_smoke.py   # ~20 s; then open smoke_out\site\index.html
```

## Workflow on your runs

1. **Adapter.** Copy `adapters/TEMPLATE.py` → `adapters/truss_adapter.py`, fill the TODOs (model factory, checkpoint path, probe batch for the fold, your `loss_terms`). Read the four rules at the top of the template.
2. **Existing checkpoints, no training:**
   ```powershell
   python -m lfp probe --adapter adapters\truss_adapter.py --runs <runs_root> --out fp\stage1 --filter fold=0
   python -m lfp pairs --adapter adapters\truss_adapter.py --runs <runs_root> --out fp\stage1 --group-by cell,fold --filter fold=0
   ```
3. **New runs, with trajectories:** inside your training loop
   ```python
   from lfp import FingerprintRecorder
   rec = FingerprintRecorder("fp/base", run_id, meta, epochs=(1, 5, 10, 20))
   ...  # after each epoch:
   rec.on_epoch_end(epoch, make_handle(model))
   ...  # after training:
   rec.on_train_end(make_handle(best_model), final_metrics=metrics)
   ```
   Verify once that training with and without the recorder is bit-for-bit identical (the smoke test does exactly this check; it passes here).
4. **Site:**
   ```powershell
   python -m lfp build-site --fp fp\stage1 fp\base --ledger runs\stage1\grade\ledger.csv --key name --out explorer --clean
   ```
   Open `explorer\index.html` directly (data is embedded in `data\bundle.js`, so no server is needed; Plotly loads from cdnjs). `explorer\data\fp_summary.csv` is the one-row-per-run table. To publish, commit `explorer/`: the home page detects `explorer/data/bundle.json` and switches its status panel from "awaiting first ATLAS run" to the run summary, with a link in. Use `--out site_build` for private builds you don't want published (it is git-ignored).
5. **Exploratory kill-test preview** (design data only):
   ```powershell
   python -m lfp killtest --summary site_build\data\fp_summary.csv --target led_pnc_wp --hyper meta_alpha --group meta_seed
   ```
   Ridge regression, grouped CV by seed, with a permutation null. The real kill test runs once, pre-registered, on held-out data.

## Things that will bite

- **Permutation symmetry.** Interpolation barriers between unaligned seeds are > 0 even for equivalent solutions. Compare groups of pairs (healthy–healthy vs healthy–degraded), never against zero. Prediction distance is the permutation-free cross-check.
- **Negative curvature is expected.** The probe batch is held-out data, not the batch the optimizer converged on; $\lambda_{\min} < 0$ there is normal. Its *size* by cell is the signal.
- **DisCo must be twice differentiable as written.** `cdist`/`sqrt` at zero distance gives NaN Hessian-vector products; lfp flags this instead of returning garbage.
- **dCor convention.** `lfp.probes.dcor` returns dCor² (the usual DisCo penalty). If your training penalizes dCor, call `lfp.probes.set_dcor_squared(False)` once at start-up (in your adapter).
- **α = 0 runs** still report BCE/DisCo conflict: it is the conflict the DisCo term *would* exert, with zero weight in the objective.
- **Cost.** Every snapshot's `timing_s` is recorded. Time one run before launching many; the Hessian probes dominate.

## Public site

GitHub Pages serves the repo root. `index.html` is the home page: what a fingerprint is, the **hypothesis sketches** (the shapes expected for H1–H4, the dCor gap and the kill test, each with a toggle to its null outcome; schematic, no data), the explorer status, the pipeline and the open decisions. The sketches live in `assets/js/sketches.js` as closed-form shapes, so they never depend on a run. The measured counterparts are the panels of the built explorer under `explorer/`, and each of those links back to its sketch.

## Status

v0.3 (mk3). Smoke-tested end to end (train → record → probe → pairs → site → killtest) on scikit-learn's bundled breast-cancer table. In-training and post-hoc fingerprints of the same weights agree exactly; the recorder leaves training bit-for-bit unchanged. Not yet run on ATLAS data. Open decisions are listed in [docs/DESIGN_HISTORY.md §12](docs/DESIGN_HISTORY.md#12-open-decisions-steves-to-make).
