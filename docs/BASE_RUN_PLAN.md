# Base run plan: how big before comparisons mean anything

## The arithmetic

Two kinds of question, two sample-size rules (two-sided $\alpha_{\text{test}} = 0.05$, power 0.8).

**Cell vs cell** (does a fingerprint feature differ between, say, $\alpha = 8$ and $\alpha = 16$?). Seeds per cell:

$$
n \approx \frac{2\,(z_{0.975} + z_{0.8})^2}{d^2} \approx \frac{15.7}{d^2}
$$

where $d$ is the difference in units of the seed SD of that feature.

| effect $d$ | seeds per cell |
|---|---|
| 2.0 | 4 |
| 1.5 | 7 |
| 1.25 | 10 |
| 1.0 | 16 |

**Fingerprint vs metric across runs** (does a feature track closure?). Total runs to detect correlation $r$:

$$
N \approx \left(\frac{z_{0.975} + z_{0.8}}{\operatorname{artanh} r}\right)^2 + 3
$$

| $r$ | runs |
|---|---|
| 0.5 | 29 |
| 0.4 | 47 |
| 0.3 | 85 |

Seed pairs do not add independent information beyond the seeds: 10 seeds give 45 pairs, but the effective sample size is still about 10.

We do not yet know the seed SD of any fingerprint feature. The first run's job is to measure it.

## Tier A: no training (Stage 1 checkpoints)

- **Runs:** cells $\alpha = 8$ and $\alpha = 16$ (and $\alpha = 32$ if its checkpoints were saved), 10 seeds each, **fold 0 only**. With 5-fold CV no event is held out from every fold, so the probe batch is fold 0's test rows and every compared model must be a fold-0 model.
- **Gives:** final-state H1 (slices), H2 (final-epoch conflict), H4 (seed pairs, 45 per cell), the dCor gap, and the seed SD of every feature.
- **Positive control:** α = 32 seed 8005 (AUC1 0.828 against a cell median of about 0.870, no collapsed fold). If no fingerprint singles it out, the fingerprints are blind to the failure mode we care about; stop and rethink before spending compute.
- **Detects:** cell differences of $d \gtrsim 1.25$; nothing reliable about correlations ($N = 20$–$30$, only 2–3 distinct $\alpha$ values).

## Tier B: the base run (new training with the recorder)

- **Runs:** $\alpha \in \{8, 16, 32\}$ × 10 seeds × fold 0 = **30 runs**, recorder at epochs 1, 5, 10, 20 and final. Same data, folds, seeds (8000–8009) and hyperparameters as Stage 1.
- **Reproduction check first:** the final AUC1 and WP %|nc| must match the Stage 1 ledger for the same (cell, seed, fold). If they don't, something in the setup differs, and every comparison below is suspect.
- **Gives:** trajectories (H2 over training, the constant-α half of H3), 30 runs for correlations (detects $r \approx 0.5$), and within-cell seed variation, which is where the fingerprints have to earn their place: the hyperparameters can only explain the cell means.
- **Cost:** about Stage 1's training time for 30 runs, plus probes. Time the probes on one run before launching (`timing_s` in each snapshot). Reduce the probe batch, `--trace-samples` or `--slice-dirs` if they dominate.

## Tier C: the LATHE pilot

The 102-run design (Sobol over $(\log\alpha_{\max}, \tau, \log n_{\text{disco}})$ × 2 architectures × 3 seeds + anchors) runs only after Tier B shows the features have usable seed SDs. That's the first point at which the kill-test question (do fingerprints beat hyperparameters at predicting held-out closure?) has the sample size to be answered.
