"""Distance correlation as in DisCo, and the minibatch-vs-full-sample dCor gap.

By default dcor() returns dCor^2, the usual DisCo penalty. If your training
penalizes dCor itself, call lfp.probes.set_dcor_squared(False) once at start-up.
"""
from __future__ import annotations

import math

import torch

from ..adapter import RunHandle
from ._util import _EPS, _eval_mode

_SQUARED = True


def set_dcor_squared(flag: bool) -> None:
    """Choose dCor^2 (True, default) or dCor (False) for every dcor() call that does not pass squared=."""
    global _SQUARED
    _SQUARED = bool(flag)


def dcor(a: torch.Tensor, b: torch.Tensor, squared: bool | None = None) -> torch.Tensor:
    """Distance correlation (biased V-statistic), as in DisCo."""
    # |a_i - a_j| via abs, not cdist: cdist's double-backward is NaN on the zero
    # diagonal, which would poison every Hessian-vector product through DisCo.
    a = a.reshape(-1, 1).double()
    b = b.reshape(-1, 1).double()
    A = (a - a.T).abs()
    B = (b - b.T).abs()
    A = A - A.mean(0, keepdim=True) - A.mean(1, keepdim=True) + A.mean()
    B = B - B.mean(0, keepdim=True) - B.mean(1, keepdim=True) + B.mean()
    dcov2 = (A * B).mean()
    denom = torch.sqrt((A * A).mean() * (B * B).mean())
    r2 = dcov2 / (denom + _EPS)
    squared = _SQUARED if squared is None else squared
    return r2 if squared else torch.sqrt(torch.clamp(r2, min=0))


@torch.no_grad()
def dcor_gap(h: RunHandle, n_full: int = 4096, reps: int = 20, seed: int = 0) -> dict | None:
    """Mean DisCo-sized minibatch dCor vs dCor on a large background sample, with a shuffled-pair baseline.

    DisCo is a batch statistic: the average of minibatch dCor is not the
    full-sample dCor. Part of that gap is the estimator itself: the V-statistic
    is biased upward at small n even when the two scores are independent, so a
    positive gap is expected for any network. The baseline repeats the same
    draws with b shuffled once (same marginals, dependence removed):

        gap        = mean_minibatch - full
        gap_null   = the same quantity on the shuffled pairing (estimator bias floor)
        gap_excess = gap - gap_null

    Read gap_excess, not gap, as "training optimized a biased target". It is
    approximate: the estimator's upward bias shrinks as dependence grows, so on
    plainly dependent scores gap_excess runs slightly NEGATIVE (measured: about
    -0.2 mini_sd at a linear correlation of 0.5). Treat |gap_excess| below about
    one mini_sd as zero; only a clearly positive excess is a finding.
    """
    if h.disco_pair is None or h.disco_batch is None:
        return None
    with _eval_mode(h.model):
        a, b = h.disco_pair(h.model, h.disco_batch)
    a, b = a.reshape(-1).cpu(), b.reshape(-1).cpu()
    N = a.numel()
    gen = torch.Generator().manual_seed(seed + 11)
    n_mini = int(h.disco_minibatch or 256)
    n_mini = min(n_mini, N)
    b_null = b[torch.randperm(N, generator=gen)]
    idx_full = torch.randperm(N, generator=gen)[: min(N, n_full)]
    full = float(dcor(a[idx_full], b[idx_full]))
    full_null = float(dcor(a[idx_full], b_null[idx_full]))
    mins, mins_null = [], []
    for _ in range(reps):
        idx = torch.randperm(N, generator=gen)[:n_mini]
        mins.append(float(dcor(a[idx], b[idx])))
        mins_null.append(float(dcor(a[idx], b_null[idx])))

    def mean_sd(xs):
        m = sum(xs) / len(xs)
        return m, math.sqrt(sum((x - m) ** 2 for x in xs) / max(1, len(xs) - 1))

    m, sd = mean_sd(mins)
    mn, sdn = mean_sd(mins_null)
    gap, gap_null = m - full, mn - full_null
    return {"mini_mean": m, "mini_sd": sd, "full": full, "gap": gap,
            "null_mini_mean": mn, "null_mini_sd": sdn, "null_full": full_null, "gap_null": gap_null,
            "gap_excess": gap - gap_null,
            "n_mini": n_mini, "n_full": int(idx_full.numel()), "reps": reps, "squared": _SQUARED}
