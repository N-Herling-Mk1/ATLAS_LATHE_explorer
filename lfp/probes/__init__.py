"""Landscape probes. Every probe takes a RunHandle (see lfp.adapter).

All probes run with the model in eval mode (dropout off), restore the mode
afterwards, and never change the weights they are given.

Conventions
-----------
* "total" is sum(weights[k] * terms[k]), exactly the training objective.
* Layers are module paths: parameter "net.0.weight" belongs to layer "net.0".
* dCor values are dCor^2 by default (see set_dcor_squared).

Modules
-------
conflict   per-layer direction c, balance rho, cancellation kappa
curvature  lambda_max, lambda_min (shifted power iteration), trace (Hutchinson)
slices     filter-normalized 1-D slices and their rise / width / roughness
pairs      seed-pair interpolation barrier and prediction distance
dcor       distance correlation and the minibatch-vs-full gap
snapshot   run a chosen set of probes once
"""
from .conflict import losses_and_conflict
from .curvature import hessian_top_eig, hessian_trace
from .dcor import dcor, dcor_gap, set_dcor_squared
from .pairs import interp_barrier, prediction_distance
from .slices import loss_slice
from .snapshot import PROBES_DURING_TRAINING, PROBES_FINAL, snapshot

__all__ = ["losses_and_conflict", "hessian_top_eig", "hessian_trace", "dcor", "dcor_gap", "set_dcor_squared",
           "interp_barrier", "prediction_distance", "loss_slice", "snapshot", "PROBES_DURING_TRAINING", "PROBES_FINAL"]
