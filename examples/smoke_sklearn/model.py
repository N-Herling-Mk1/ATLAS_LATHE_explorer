"""Smoke-test stand-in: a small BCE + alpha*DisCo classifier on a real public dataset.

Dataset: scikit-learn's bundled Wisconsin breast-cancer table (569 real
measurements, ships with scikit-learn, no download). Class 0 (benign) plays
"background"; the feature "mean area" plays the protected variable that
DisCo decorrelates the score from on background, and is removed from the
inputs. This exists only to exercise lfp end to end. It says nothing about
the ATLAS models.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch
from sklearn.datasets import load_breast_cancer
from sklearn.metrics import roc_auc_score

from lfp.adapter import RunHandle
from lfp.probes import dcor

PROTECTED = "mean area"
SPLIT_SEED = 0  # fixed: every run shares the same train / val / probe events


def load_data():
    ds = load_breast_cancer()
    names = list(ds.feature_names)
    X = ds.data.astype(np.float32)
    y = (ds.target == 0).astype(np.float32)  # 1 = malignant ("signal"), 0 = benign ("background")
    j = names.index(PROTECTED)
    z = X[:, j].copy()
    X = np.delete(X, j, axis=1)
    rng = np.random.default_rng(SPLIT_SEED)
    idx = rng.permutation(len(y))
    n_tr, n_va = int(0.6 * len(y)), int(0.15 * len(y))
    tr, va, pr = idx[:n_tr], idx[n_tr:n_tr + n_va], idx[n_tr + n_va:]
    mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-6
    X = (X - mu) / sd
    zs = (z - z[tr].mean()) / (z[tr].std() + 1e-6)

    def pack(ix):
        return {"x": torch.tensor(X[ix]), "y": torch.tensor(y[ix]), "z": torch.tensor(zs[ix])}

    return pack(tr), pack(va), pack(pr)


class MLP(torch.nn.Module):
    def __init__(self, n_in, hidden=(32, 32)):
        super().__init__()
        layers, d = [], n_in
        for hdim in hidden:
            layers += [torch.nn.Linear(d, hdim), torch.nn.ReLU()]
            d = hdim
        layers.append(torch.nn.Linear(d, 1))
        self.net = torch.nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x).squeeze(-1)


def loss_terms(model, batch):
    """Exactly the training objective's pieces: BCE on all events, DisCo on background only."""
    logit = model(batch["x"])
    bce = torch.nn.functional.binary_cross_entropy_with_logits(logit, batch["y"])
    bg = batch["y"] < 0.5
    s = torch.sigmoid(logit[bg])
    disco = dcor(s, batch["z"][bg]).float()
    return {"bce": bce, "disco": disco}


def predict(model, batch):
    return torch.sigmoid(model(batch["x"]))


def disco_pair(model, batch):
    bg = batch["y"] < 0.5
    return torch.sigmoid(model(batch["x"][bg])), batch["z"][bg]


def make_handle(run_id, meta, model, probe, n_disco, state_path=None):
    return RunHandle(run_id=run_id, meta=meta, model=model, loss_terms=loss_terms,
                     weights={"bce": 1.0, "disco": float(meta["alpha"])}, probe_batch=probe,
                     predict=predict, disco_pair=disco_pair, disco_batch=probe,
                     disco_minibatch=n_disco, state_path=state_path)


def evaluate(model, batch):
    model.eval()
    with torch.no_grad():
        s = predict(model, batch).numpy()
        y = batch["y"].numpy()
        bg = y < 0.5
        auc = roc_auc_score(y, s)
        dc = float(dcor(torch.tensor(s[bg]), batch["z"][bg]))
    return {"auc": float(auc), "dcor_bg": dc}


def train_run(out_root, alpha, seed, epochs=40, batch_size=64, n_disco=64, lr=3e-3, recorder_factory=None):
    tr, va, pr = load_data()
    torch.manual_seed(seed)
    model = MLP(tr["x"].shape[1])
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    cell = f"a{alpha:g}"
    run_id = f"smoke_{cell}_s{seed}"
    meta = {"cell": cell, "alpha": alpha, "seed": seed, "fold": 0, "arch": "32-32", "n_disco": n_disco}
    rec = recorder_factory(run_id, meta) if recorder_factory else None
    gen = torch.Generator().manual_seed(seed)
    n = tr["y"].shape[0]
    bg_idx = torch.nonzero(tr["y"] < 0.5).squeeze(-1)
    for epoch in range(1, epochs + 1):
        model.train()
        perm = torch.randperm(n, generator=gen)
        for i in range(0, n, batch_size):
            ix = perm[i:i + batch_size]
            logit = model(tr["x"][ix])
            bce = torch.nn.functional.binary_cross_entropy_with_logits(logit, tr["y"][ix])
            dix = bg_idx[torch.randperm(bg_idx.numel(), generator=gen)[:n_disco]]  # background-only DisCo draw
            disco = dcor(torch.sigmoid(model(tr["x"][dix])), tr["z"][dix]).float()
            loss = bce + alpha * disco
            opt.zero_grad()
            loss.backward()
            opt.step()
        if rec:
            rec.on_epoch_end(epoch, make_handle(run_id, meta, model, pr, n_disco))
    metrics = evaluate(model, va)
    run_dir = Path(out_root) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), run_dir / "model.pt")
    (run_dir / "config.json").write_text(json.dumps({"meta": meta, "metrics": metrics}, indent=1))
    if rec:
        rec.on_train_end(make_handle(run_id, meta, model, pr, n_disco), final_metrics=metrics)
    return run_id, meta, metrics
