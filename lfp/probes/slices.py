"""Filter-normalized 1-D loss slices (Li et al. 2018) and their shape summary."""
from __future__ import annotations

import torch

from ..adapter import RunHandle
from ._util import _EPS, _eval_mode, _eval_terms, _named_params


def _filter_normalized_direction(named, gen):
    """Li et al. 2018: per-filter (row) normalized random direction; 1-D params (bias, norm) get 0."""
    d = []
    for _, p in named:
        if p.dim() <= 1:
            d.append(torch.zeros_like(p))
            continue
        r = torch.randn(p.shape, generator=gen).to(p.device, p.dtype)
        pr = p.detach().reshape(p.shape[0], -1)
        rr = r.reshape(p.shape[0], -1)
        scale = pr.norm(dim=1, keepdim=True) / (rr.norm(dim=1, keepdim=True) + _EPS)
        d.append((rr * scale).reshape(p.shape))
    return d


def loss_slice(h: RunHandle, span: float = 1.0, points: int = 21, directions: int = 3, seed: int = 0) -> dict:
    """Filter-normalized 1-D slices through the current weights.

    Returns per-direction curves of total loss (and each term) at
    theta + a * d for a in [-span, span], plus summary shape numbers:
      rise      mean of L(+-span) - L(0)       (bigger = steeper basin)
      width     mean |a| where L - L(0) first reaches 10% of |L(0)| (smaller = narrower)
      rough     RMS residual of a quadratic fit, / range of L (bigger = bumpier)
    The same seed gives the same random draw for the same architecture, so
    slices are comparable across runs of one architecture.
    """
    model = h.model
    named = _named_params(model)
    alphas = [-span + 2.0 * span * i / (points - 1) for i in range(points)]
    gen = torch.Generator().manual_seed(seed + 7)
    curves_total, curves_terms = [], []
    base = [p.detach().clone() for _, p in named]
    with _eval_mode(model):
        try:
            for _ in range(directions):
                d = _filter_normalized_direction(named, gen)
                tot, trm = [], {}
                for a in alphas:
                    with torch.no_grad():
                        for (_, p), b0, di in zip(named, base, d):
                            p.copy_(b0 + a * di)
                    terms, total = _eval_terms(h, model)
                    tot.append(total)
                    for k, v in terms.items():
                        trm.setdefault(k, []).append(v)
                curves_total.append(tot)
                curves_terms.append(trm)
        finally:
            with torch.no_grad():
                for (_, p), b0 in zip(named, base):
                    p.copy_(b0)
    return {"alphas": alphas, "total": curves_total, "terms": curves_terms, "summary": _slice_summary(alphas, curves_total)}


def _slice_summary(alphas, curves):
    import numpy as np

    a = np.asarray(alphas)
    c0 = len(a) // 2
    rises, widths, roughs = [], [], []
    for cur in curves:
        y = np.asarray(cur)
        L0 = y[c0]
        rises.append(float((y[0] + y[-1]) / 2 - L0))
        thr = 0.10 * max(abs(L0), 1e-9)
        w = []
        for side in (range(c0, len(a)), range(c0, -1, -1)):
            hit = next((abs(a[i]) for i in side if y[i] - L0 >= thr), abs(a[-1]))
            w.append(hit)
        widths.append(float(np.mean(w)))
        coef = np.polyfit(a, y, 2)
        resid = y - np.polyval(coef, a)
        rng = float(y.max() - y.min()) or 1e-9
        roughs.append(float(np.sqrt(np.mean(resid ** 2)) / rng))
    return {"rise": float(np.mean(rises)), "width": float(np.mean(widths)), "rough": float(np.mean(roughs)),
            "rise_per_dir": rises, "width_per_dir": widths, "rough_per_dir": roughs}
