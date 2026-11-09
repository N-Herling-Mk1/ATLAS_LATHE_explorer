"""The contract between your training code and the probes.

The probes never import your training code. You write one small adapter module
(see adapters/TEMPLATE.py) that turns a run directory -- or a live model during
training -- into a RunHandle. Everything in lfp works from RunHandles only.

A RunHandle must give:
  model        torch.nn.Module, already holding the weights to probe
  loss_terms   f(model, batch) -> {"bce": scalar, "disco": scalar, ...}
               differentiable scalars, computed exactly as in training
  weights      {"bce": 1.0, "disco": alpha, ...}; total = sum(w * term)
  probe_batch  the fixed held-out "map events" batch, passed to loss_terms.
               Must be identical (same events, same order) for every run that
               will be compared -- interpolation barriers refuse otherwise.

Optional:
  predict      f(model, batch) -> per-event score tensor (seed-pair functional distance)
  disco_pair   f(model, batch) -> (a, b) 1-D tensors whose dCor DisCo penalizes
  disco_batch  background-only batch for the minibatch-vs-full dCor gap
  disco_minibatch  the minibatch size DisCo saw in training (n_disco)
  state_path   where the weights came from (provenance only)
"""
from __future__ import annotations

import hashlib
import importlib.util
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

import torch

LossTerms = Callable[[torch.nn.Module, Any], dict]


@dataclass
class RunHandle:
    run_id: str
    meta: dict
    model: torch.nn.Module
    loss_terms: LossTerms
    weights: dict
    probe_batch: Any
    predict: Optional[Callable[[torch.nn.Module, Any], torch.Tensor]] = None
    disco_pair: Optional[Callable[[torch.nn.Module, Any], tuple]] = None
    disco_batch: Any = None
    disco_minibatch: Optional[int] = None
    state_path: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def total(self, terms: dict) -> torch.Tensor:
        missing = [k for k in self.weights if k not in terms]
        if missing:
            raise KeyError(f"{self.run_id}: loss_terms did not return {missing}")
        return sum(float(w) * terms[k] for k, w in self.weights.items())


def batch_fingerprint(batch: Any) -> str:
    """Stable hash of a probe batch (tensors / dicts / tuples of tensors)."""
    h = hashlib.sha1()

    def feed(x):
        if isinstance(x, torch.Tensor):
            t = x.detach().cpu().contiguous()
            h.update(str(tuple(t.shape)).encode())
            h.update(str(t.dtype).encode())
            h.update(t.numpy().tobytes())
        elif isinstance(x, dict):
            for k in sorted(x):
                h.update(str(k).encode())
                feed(x[k])
        elif isinstance(x, (list, tuple)):
            for v in x:
                feed(v)
        else:
            h.update(repr(x).encode())

    feed(batch)
    return h.hexdigest()[:16]


def load_adapter(path: str):
    """Import a user adapter module from a file path.

    Required functions in the module:
      list_runs(root: str) -> list[str]        run directories (or any id load_run accepts)
      load_run(run: str, device: str) -> RunHandle
    """
    p = Path(path).resolve()
    if not p.is_file():
        raise FileNotFoundError(f"adapter not found: {p}")
    spec = importlib.util.spec_from_file_location(f"lfp_user_adapter_{p.stem}", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for fn in ("list_runs", "load_run"):
        if not hasattr(mod, fn):
            raise AttributeError(f"adapter {p.name} must define {fn}()")
    return mod
