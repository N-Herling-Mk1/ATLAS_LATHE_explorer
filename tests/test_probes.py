"""Analytic checks of the probes against answers known in closed form.

These use small hand-built quadratic objectives and random vectors to verify
the mathematics of each probe. They are correctness tests for the code, not
analysis inputs. Run:  python -m pytest -q tests   (or: python tests/test_probes.py)
"""
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lfp.adapter import RunHandle  # noqa: E402
from lfp import probes  # noqa: E402


class Quad(torch.nn.Module):
    def __init__(self, W):
        super().__init__()
        self.W = torch.nn.Parameter(W.clone())


def quad_handle(a1, a2, W, W0=None, w_disco=2.0, run_id="q"):
    W0 = torch.zeros_like(W) if W0 is None else W0
    m = Quad(W)

    def terms(model, batch):
        D = model.W - W0
        return {"bce": 0.5 * (a1 * D ** 2).sum(), "disco": 0.5 * (a2 * D ** 2).sum()}

    return RunHandle(run_id, {"cell": "q"}, m, terms, {"bce": 1.0, "disco": w_disco}, probe_batch=torch.zeros(1))


def test_hessian_top_eig_and_trace():
    torch.manual_seed(0)
    a1 = torch.rand(4, 5) + 0.1
    a2 = torch.rand(4, 5) + 0.1
    h = quad_handle(a1, a2, torch.randn(4, 5))
    diag = (a1 + 2.0 * a2).reshape(-1)
    top = probes.hessian_top_eig(h, iters=2000, tol=1e-12)
    assert abs(top["lam_max"] - float(diag.max())) < 1e-3 * float(diag.max()), top
    assert abs(top["lam_min"] - float(diag.min())) < 1e-2 * float(diag.max()), top
    tr = probes.hessian_trace(h, samples=8)
    # Rademacher probes are exact for a diagonal Hessian: v^T D v = tr(D) every time
    assert abs(tr["trace"] - float(diag.sum())) < 1e-6, tr


def test_hessian_both_ends_indefinite():
    torch.manual_seed(3)
    a1 = torch.tensor([[3.0, -5.0, 1.0], [0.5, 2.0, -1.0]])
    h = quad_handle(a1, torch.zeros_like(a1), torch.randn(2, 3), w_disco=0.0)
    top = probes.hessian_top_eig(h, iters=2000, tol=1e-12)
    assert abs(top["top_eig"] + 5.0) < 1e-3, top          # dominant = largest magnitude
    assert abs(top["lam_min"] + 5.0) < 1e-3, top
    assert abs(top["lam_max"] - 3.0) < 1e-2, top


def test_conflict_sign():
    m = Quad(torch.randn(3, 3))

    def terms(model, batch):
        return {"bce": model.W.sum(), "disco": -model.W.sum()}

    h = RunHandle("c", {}, m, terms, {"bce": 1.0, "disco": 1.0}, torch.zeros(1))
    c = probes.losses_and_conflict(h)["conflict"]
    assert abs(c["global"] + 1.0) < 1e-9
    assert all(abs(v + 1.0) < 1e-9 for v in c["per_layer"].values())
    # equal and opposite pulls: balance 1, full cancellation
    assert all(abs(v - 1.0) < 1e-6 for v in c["balance"].values())
    assert all(abs(v) < 1e-6 for v in c["cancel"].values())
    # half-weight DisCo: rho = 0.5, kappa = |1 - 0.5| / (1 + 0.5) = 1/3
    h.weights = {"bce": 1.0, "disco": 0.5}
    c = probes.losses_and_conflict(h)["conflict"]
    assert all(abs(v - 0.5) < 1e-6 for v in c["balance"].values())
    assert all(abs(v - 1 / 3) < 1e-6 for v in c["cancel"].values())


def test_barrier_convex_is_zero():
    a = torch.rand(3, 4) + 0.5
    ha = quad_handle(a, a, torch.randn(3, 4), run_id="A")
    hb = quad_handle(a, a, torch.randn(3, 4), run_id="B")
    r = probes.interp_barrier(ha, hb, points=21)
    # convex objective lies below its chord, so max over t of (L - chord) is 0, at the endpoints
    assert abs(r["barrier"]) < 1e-9 and r["barrier"] >= -1e-12, r["barrier"]


def test_barrier_refuses_mismatched_probe_batch():
    a = torch.rand(2, 2) + 0.5
    ha = quad_handle(a, a, torch.randn(2, 2), run_id="A")
    hb = quad_handle(a, a, torch.randn(2, 2), run_id="B")
    hb.probe_batch = torch.ones(1)
    try:
        probes.interp_barrier(ha, hb)
    except ValueError:
        return
    raise AssertionError("expected ValueError for different probe batches")


def test_slice_at_minimum_is_symmetric_parabola():
    W0 = torch.randn(4, 6)
    a = torch.rand(4, 6) + 0.2
    h = quad_handle(a, a, W0.clone(), W0=W0)
    s = probes.loss_slice(h, span=1.0, points=21, directions=2)
    for cur in s["total"]:
        scale = max(abs(v) for v in cur)
        assert all(abs(cur[i] - cur[-1 - i]) < 1e-6 * scale for i in range(len(cur)))  # float32 weights
    assert s["summary"]["rough"] < 1e-6
    assert torch.allclose(h.model.W.detach(), W0)  # weights restored


def test_dcor_values():
    torch.manual_seed(1)
    x = torch.randn(2000)
    assert abs(float(probes.dcor(x, x)) - 1.0) < 1e-9
    assert abs(float(probes.dcor(x, 2 * x + 3)) - 1.0) < 1e-9
    y = torch.randn(2000)
    assert float(probes.dcor(x, y)) < 0.01


def test_dcor_gap_small_batches_biased_up():
    torch.manual_seed(2)
    a, b = torch.randn(5000), torch.randn(5000)
    m = Quad(torch.randn(2, 2))
    h = RunHandle("d", {}, m, lambda mod, bt: {"bce": mod.W.sum()}, {"bce": 1.0}, torch.zeros(1),
                  disco_pair=lambda mod, bt: (a, b), disco_batch=0, disco_minibatch=64)
    g = probes.dcor_gap(h, n_full=4000, reps=50)
    assert g["mini_mean"] > g["full"] and g["gap"] > 0


def test_snapshot_leaves_global_rng_alone():
    a = torch.rand(3, 3) + 0.1
    h = quad_handle(a, a, torch.randn(3, 3))
    before = torch.random.get_rng_state().clone()
    probes.snapshot(h, 1, probes=("conflict", "hessian", "trace", "slice"))
    assert torch.equal(before, torch.random.get_rng_state())


if __name__ == "__main__":
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"{len(fns)} passed")
