"""Per-layer competition between two loss terms: direction c, balance rho, cancellation kappa."""
from __future__ import annotations

import torch

from ..adapter import RunHandle
from ._util import _EPS, _eval_mode, _f, _flat, _grads, _layers, _named_params


def losses_and_conflict(h: RunHandle, pair=("bce", "disco")) -> dict:
    """Per-term losses on the probe batch, and per-layer gradient conflict.

    conflict[layer] = cos(grad term_a, grad term_b) restricted to that layer.
    Negative = the two loss terms pull that layer's weights in opposing
    directions. Also returns per-term gradient norms per layer.
    """
    model = h.model
    named = _named_params(model)
    params = [p for _, p in named]
    layers = _layers(named)
    with _eval_mode(model):
        terms = h.loss_terms(model, h.probe_batch)
        total = h.total(terms)
        out = {"losses": {k: _f(v) for k, v in terms.items()}, "total": _f(total)}
        a, b = pair
        if a not in terms or b not in terms:
            out["conflict"] = None
            return out
        ga = _grads(terms[a], params)
        gb = _grads(terms[b], params)
    wa, wb = float(h.weights.get(a, 1.0)), float(h.weights.get(b, 0.0))
    per_layer, norm_a, norm_b, balance, cancel = {}, {}, {}, {}, {}
    for lname, idx in layers.items():
        va = _flat([ga[i] for i in idx])
        vb = _flat([gb[i] for i in idx])
        na, nb = va.norm(), vb.norm()
        norm_a[lname], norm_b[lname] = _f(na), _f(nb)
        per_layer[lname] = _f(torch.dot(va, vb) / (na * nb + _EPS)) if (na > 0 and nb > 0) else None
        pa, pb = wa * na, wb * nb  # weighted pull of each term on this layer
        balance[lname] = _f(pb / pa) if pa > 0 else None
        cancel[lname] = _f((wa * va + wb * vb).norm() / (pa + pb)) if (pa + pb) > 0 else None
    va, vb = _flat(ga), _flat(gb)
    out["conflict"] = {
        "pair": list(pair),
        "weights": [wa, wb],
        "global": _f(torch.dot(va, vb) / (va.norm() * vb.norm() + _EPS)),
        "per_layer": per_layer,
        # rho = w_b|g_b| / (w_a|g_a|): ~1 means the two weighted pulls are comparable
        "balance": balance,
        # kappa = |w_a g_a + w_b g_b| / (w_a|g_a| + w_b|g_b|): ~0 = pulls cancel (stall), 1 = pull together
        "cancel": cancel,
        "layer_order": list(layers),
        "gradnorm": {a: norm_a, b: norm_b},
    }
    return out
