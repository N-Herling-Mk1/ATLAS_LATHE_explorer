"""Hessian spectrum ends (shifted power iteration) and trace (Hutchinson), via Hessian-vector products."""
from __future__ import annotations

import math

import torch

from ..adapter import RunHandle
from ._util import _EPS, _eval_mode, _f, _flat, _grads, _named_params


class _HVP:
    """Hessian-vector products of the total loss, graph built once."""

    def __init__(self, h: RunHandle):
        self.model = h.model
        self.params = [p for _, p in _named_params(self.model)]
        terms = h.loss_terms(self.model, h.probe_batch)
        self.total = h.total(terms)
        self.g = _grads(self.total, self.params, retain=True, create=True)

    def __call__(self, vec):
        hv = torch.autograd.grad(self.g, self.params, grad_outputs=vec, retain_graph=True, allow_unused=True)
        return [torch.zeros_like(p) if x is None else x.detach() for x, p in zip(hv, self.params)]


_NONFINITE = ("non-finite Hessian-vector product: the loss is not twice differentiable as implemented "
              "(typical cause: sqrt or cdist at zero distance inside DisCo)")


def _power(hvp, shift, iters, tol, gen):
    """Dominant eigenvalue of (H - shift*I). Returns (value, history, converged, error)."""
    v = [torch.randn(p.shape, generator=gen).to(p.device, p.dtype) for p in hvp.params]
    nv = _flat(v).norm()
    v = [x / nv for x in v]
    lam, hist = None, []
    for _ in range(iters):
        hv = hvp(v)
        if shift:
            hv = [a - shift * b for a, b in zip(hv, v)]
        if not torch.isfinite(_flat(hv)).all():
            return None, hist, False, _NONFINITE
        new = _f(torch.dot(_flat(v), _flat(hv)))
        hist.append(new)
        n = _flat(hv).norm()
        if n <= 0:
            return new, hist, True, None
        v = [x / n for x in hv]
        if lam is not None and abs(new - lam) <= tol * (abs(new) + _EPS):
            return new, hist, True, None
        lam = new
    return lam, hist, False, None


def hessian_top_eig(h: RunHandle, iters: int = 50, tol: float = 1e-3, seed: int = 0) -> dict:
    """Both ends of the Hessian spectrum by (shifted) power iteration.

    top_eig   dominant eigenvalue (largest MAGNITUDE; may be negative)
    lam_max   largest algebraic eigenvalue  (sharpest upward curvature)
    lam_min   smallest algebraic eigenvalue (most negative curvature; >= 0 means none found)
    A first pass finds the dominant eigenvalue; a second pass on H - dominant*I
    finds the opposite end. Negative curvature on the probe batch is normal:
    it is held-out data, not the batch the optimizer converged on.
    """
    with _eval_mode(h.model):
        hvp = _HVP(h)
        gen = torch.Generator().manual_seed(seed)
        dom, hist1, conv1, err = _power(hvp, 0.0, iters, tol, gen)
        if err:
            return {"top_eig": None, "lam_max": None, "lam_min": None, "iters": len(hist1),
                    "converged": False, "history": hist1, "error": err}
        mu, hist2, conv2, err = _power(hvp, dom, iters, tol, gen)
    other = None if (mu is None or err) else mu + dom
    if other is None:
        lam_max, lam_min = (dom, None) if dom >= 0 else (None, dom)
    else:
        lam_max, lam_min = max(dom, other), min(dom, other)
    return {"top_eig": dom, "lam_max": lam_max, "lam_min": lam_min, "iters": len(hist1) + len(hist2),
            "converged": bool(conv1 and conv2), "history": hist1, "history_shifted": hist2}


def hessian_trace(h: RunHandle, samples: int = 32, seed: int = 0) -> dict:
    """Hutchinson estimate of tr(H) with Rademacher probes; returns mean and standard error."""
    with _eval_mode(h.model):
        hvp = _HVP(h)
        gen = torch.Generator().manual_seed(seed + 1)
        vals = []
        for _ in range(samples):
            v = [(torch.randint(0, 2, p.shape, generator=gen) * 2 - 1).to(p.device, p.dtype) for p in hvp.params]
            vals.append(_f(torch.dot(_flat(v), _flat(hvp(v)))))
    if not all(math.isfinite(x) for x in vals):
        return {"trace": None, "trace_se": None, "samples": samples,
                "error": "non-finite Hessian-vector product (see hessian_top_eig)"}
    m = sum(vals) / len(vals)
    se = math.sqrt(sum((x - m) ** 2 for x in vals) / max(1, len(vals) - 1) / len(vals))
    return {"trace": m, "trace_se": se, "samples": samples}
