"""Adapter template for your own runs. Copy to e.g. adapters/truss_adapter.py and fill the TODOs.

lfp never imports your training code by itself. This file is the only bridge:
it turns one run directory into an lfp.RunHandle. Keep it thin; import your
own model / data / loss code rather than re-implementing it, so the probes
see exactly the objective you trained.

Rules the probes rely on (they check the first two and refuse to compare otherwise):
  1. probe_batch is the SAME events, in the SAME order, for every run you compare.
     With k-fold CV no event is held out for all folds, so compare within one
     fold: use that fold's test rows (or a slice carved out before CV).
  2. weights match the run's training objective (bce 1.0, disco alpha, ...).
  3. loss_terms computes each term exactly as training does, on probe_batch.
     If training draws DisCo on background-only minibatches, compute it here on
     the background events of probe_batch (dCor over N_bg events costs O(N_bg^2)
     memory, and the Hessian probes differentiate through it twice: keep N_bg
     around 1-2k for the probes).
  4. The loss must be twice differentiable as written. lfp.probes.dcor uses
     abs() pairwise distances for this reason; torch.cdist or sqrt at zero
     distance gives NaN Hessian-vector products (lfp reports this instead of
     silently returning garbage).
"""
from pathlib import Path

import torch

from lfp import RunHandle


def list_runs(root):
    """Return every run this adapter can load under root (directories, files, or ids)."""
    # TODO: match your layout, e.g. one folder per run with a checkpoint inside
    return sorted(str(p.parent) for p in Path(root).glob("*/*/model.pt"))


def run_meta(run):
    """Cheap metadata without loading weights (used by `lfp pairs` to group runs).

    Include at least: cell, seed, fold, and the loss settings (alpha, beta, tau, n_disco, ...).
    """
    # TODO: parse from your run name / config file
    raise NotImplementedError


def load_run(run, device="cpu"):
    meta = run_meta(run)
    # TODO: build the network exactly as trained and load its weights
    model = ...  # your model factory
    model.load_state_dict(torch.load(Path(run) / "model.pt", map_location=device))
    model.to(device)

    # TODO: the fixed probe events for this fold, already scaled with this run's scaler.
    # Return any structure your loss_terms understands (dict of tensors is easiest).
    probe = ...

    def loss_terms(m, batch):
        # TODO: call your own loss code; return each term separately
        logit = m(batch["x"])
        bce = torch.nn.functional.binary_cross_entropy_with_logits(logit, batch["y"])
        disco = ...  # your DisCo on the background events of batch
        return {"bce": bce, "disco": disco}

    def predict(m, batch):
        return torch.sigmoid(m(batch["x"]))

    def disco_pair(m, batch):
        # TODO: the two 1-D vectors whose dCor DisCo penalizes, background events only
        bg = batch["y"] < 0.5
        return torch.sigmoid(m(batch["x"][bg])), batch["partner"][bg]

    return RunHandle(
        run_id=Path(run).name, meta=meta, model=model, loss_terms=loss_terms,
        weights={"bce": 1.0, "disco": float(meta["alpha"])},
        probe_batch=probe, predict=predict, disco_pair=disco_pair, disco_batch=probe,
        disco_minibatch=int(meta.get("n_disco", 256)), state_path=str(Path(run) / "model.pt"),
    )
