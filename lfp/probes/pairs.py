"""Seed-pair comparisons: linear-interpolation barrier (weight space) and prediction distance (function space)."""
from __future__ import annotations

import copy

import torch

from ..adapter import RunHandle, batch_fingerprint
from ._util import _EPS, _eval_mode, _eval_terms, _named_params


def interp_barrier(ha: RunHandle, hb: RunHandle, points: int = 11) -> dict:
    """Loss along the straight line theta(t) = (1-t) theta_A + t theta_B, on A's probe batch.

    barrier = max_t [ L(t) - ((1-t) L(0) + t L(1)) ]   (0 = no bump above the chord)

    CAUTION: hidden units can be permuted without changing the network, so two
    seeds that found the *same* solution can still show a barrier unless their
    units are aligned first. Compare barriers between groups of pairs
    (healthy-healthy vs healthy-degraded), not against zero.
    """
    na, nb = _named_params(ha.model), _named_params(hb.model)
    if [(n, tuple(p.shape)) for n, p in na] != [(n, tuple(p.shape)) for n, p in nb]:
        raise ValueError(f"architectures differ: {ha.run_id} vs {hb.run_id}")
    fa, fb = batch_fingerprint(ha.probe_batch), batch_fingerprint(hb.probe_batch)
    if fa != fb:
        raise ValueError(f"probe batches differ ({fa} vs {fb}); barriers need identical events")
    if {k: float(v) for k, v in ha.weights.items()} != {k: float(v) for k, v in hb.weights.items()}:
        raise ValueError("loss weights differ between the two runs; barriers compare one objective")
    scratch = copy.deepcopy(ha.model)
    ns = _named_params(scratch)
    ts = torch.linspace(0, 1, points).tolist()
    tot, trm = [], {}
    with _eval_mode(scratch):
        for t in ts:
            with torch.no_grad():
                for (_, ps), (_, pa), (_, pb) in zip(ns, na, nb):
                    ps.copy_((1 - t) * pa.detach() + t * pb.detach())
            terms, total = _eval_terms(ha, scratch)
            tot.append(total)
            for k, v in terms.items():
                trm.setdefault(k, []).append(v)

    def barrier(y):
        return max(y[i] - ((1 - t) * y[0] + t * y[-1]) for i, t in enumerate(ts))

    return {"t": ts, "total": tot, "terms": trm, "barrier": barrier(tot),
            "barrier_terms": {k: barrier(v) for k, v in trm.items()}}


@torch.no_grad()
def prediction_distance(ha: RunHandle, hb: RunHandle) -> dict | None:
    """Permutation-free comparison of two runs: per-event score differences on the probe batch."""
    if ha.predict is None or hb.predict is None:
        return None
    with _eval_mode(ha.model), _eval_mode(hb.model):
        sa = ha.predict(ha.model, ha.probe_batch).reshape(-1).float().cpu()
        sb = hb.predict(hb.model, hb.probe_batch).reshape(-1).float().cpu()
    ra = sa.argsort().argsort().float()
    rb = sb.argsort().argsort().float()
    ra, rb = ra - ra.mean(), rb - rb.mean()
    spearman = float((ra @ rb) / (ra.norm() * rb.norm() + _EPS))
    return {"mean_abs_diff": float((sa - sb).abs().mean()), "spearman": spearman}
