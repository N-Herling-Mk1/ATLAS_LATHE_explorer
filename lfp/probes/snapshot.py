"""One fingerprint snapshot: run the selected probes and time each."""
from __future__ import annotations

import time

from ..adapter import RunHandle
from .conflict import losses_and_conflict
from .curvature import hessian_top_eig, hessian_trace
from .dcor import dcor_gap
from .slices import loss_slice


PROBES_DURING_TRAINING = ("conflict", "hessian", "trace", "dcor")


PROBES_FINAL = ("conflict", "hessian", "trace", "dcor", "slice")


def snapshot(h: RunHandle, epoch, probes=PROBES_DURING_TRAINING, cfg: dict | None = None) -> dict:
    """Run the selected probes once. epoch may be an int or "final"."""
    cfg = cfg or {}
    out = {"epoch": epoch, "timing_s": {}}

    def timed(name, fn):
        t0 = time.perf_counter()
        r = fn()
        out["timing_s"][name] = round(time.perf_counter() - t0, 4)
        return r

    lc = timed("conflict", lambda: losses_and_conflict(h, tuple(cfg.get("pair", ("bce", "disco")))))
    out["losses"], out["total"], out["conflict"] = lc["losses"], lc["total"], lc.get("conflict")
    if "conflict" not in probes:
        out["conflict"] = None
    if "hessian" in probes:
        out["hessian"] = timed("hessian", lambda: hessian_top_eig(h, iters=cfg.get("hess_iters", 50)))
    if "trace" in probes:
        out["trace"] = timed("trace", lambda: hessian_trace(h, samples=cfg.get("trace_samples", 32)))
    if "dcor" in probes:
        out["dcor"] = timed("dcor", lambda: dcor_gap(h, n_full=cfg.get("dcor_full", 4096)))
    if "slice" in probes:
        out["slice"] = timed("slice", lambda: loss_slice(h, span=cfg.get("slice_span", 1.0),
                                                         points=cfg.get("slice_points", 21),
                                                         directions=cfg.get("slice_dirs", 3)))
    return out
