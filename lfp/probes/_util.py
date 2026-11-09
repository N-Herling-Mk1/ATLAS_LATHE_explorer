"""Shared helpers for the probes (eval-mode guard, parameter/layer bookkeeping, loss evaluation)."""
from __future__ import annotations

from contextlib import contextmanager

import torch

from ..adapter import RunHandle


_EPS = 1e-12


@contextmanager
def _eval_mode(model: torch.nn.Module):
    was_training = model.training
    model.eval()
    try:
        yield
    finally:
        model.train(was_training)


def _named_params(model):
    return [(n, p) for n, p in model.named_parameters() if p.requires_grad]


def _layer_of(name: str) -> str:
    return name.rsplit(".", 1)[0] if "." in name else name


def _layers(named):
    """Ordered {layer: [indices into named]}."""
    out = {}
    for i, (n, _) in enumerate(named):
        out.setdefault(_layer_of(n), []).append(i)
    return out


def _flat(ts):
    return torch.cat([t.reshape(-1) for t in ts])


def _grads(scalar, params, retain=True, create=False):
    gs = torch.autograd.grad(scalar, params, retain_graph=retain, create_graph=create, allow_unused=True)
    return [torch.zeros_like(p) if g is None else g for g, p in zip(gs, params)]


def _f(x) -> float:
    return float(x.detach().cpu()) if isinstance(x, torch.Tensor) else float(x)


@torch.no_grad()
def _eval_terms(h: RunHandle, model, batch=None):
    terms = h.loss_terms(model, h.probe_batch if batch is None else batch)
    return {k: _f(v) for k, v in terms.items()}, _f(h.total(terms))
