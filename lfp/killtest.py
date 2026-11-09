"""Exploratory kill-test preview (see killtest())."""
from __future__ import annotations

from tqdm import tqdm

from .log import log


def killtest(summary, target, hyper, features="geo_", exclude=None, group="meta_seed", folds=5,
             repeats=20, null=200, bar=0.20, seed=0) -> int:
    """EXPLORATORY: do fingerprint features predict `target` beyond the hyperparameters?

    Ridge regression, grouped K-fold CV (groups = `group`, e.g. seed), repeated with
    shuffled group-to-fold assignment; compares CV MAE of hyper-only vs hyper+features
    and calibrates the gain against a permutation null (feature rows shuffled).
    Design data only: the pre-registered kill test runs once on held-out data.
    """
    import numpy as np
    import pandas as pd
    from sklearn.linear_model import RidgeCV
    from sklearn.model_selection import GroupKFold
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    df = pd.read_csv(summary)
    target = target
    hyper = [c for c in hyper.split(",") if c] if isinstance(hyper, str) else list(hyper)
    feats = [c for c in df.columns if any(c.startswith(p) for p in features.split(","))]
    feats = [c for c in feats if c not in hyper]
    if exclude:
        feats = [c for c in feats if not any(x in c for x in exclude.split(","))]
    need = [target, group] + hyper + feats
    missing = [c for c in need if c not in df.columns]
    if missing:
        log(f"killtest: missing columns {missing}")
        return 1
    d = df.dropna(subset=[target] + hyper).copy()
    keep = [c for c in feats if d[c].notna().mean() >= 0.9]
    dropped = sorted(set(feats) - set(keep))
    d[keep] = d[keep].fillna(d[keep].median())
    y = d[target].to_numpy(float)
    Xh = d[hyper].to_numpy(float)
    Xf = d[hyper + keep].to_numpy(float)
    groups = d[group].astype(str).to_numpy()
    n_groups = len(set(groups))
    k = min(folds, n_groups)
    log("killtest (EXPLORATORY, design data only; the pre-registered test runs on held-out data)")
    log(f"  target={target}  n={len(y)}  groups({group})={n_groups}  folds={k}")
    log(f"  hyper={hyper}")
    log(f"  features ({len(keep)}): {keep}")
    if dropped:
        log(f"  dropped for >10% missing: {dropped}")
    if k < 2 or len(y) < 8:
        log("  too few runs/groups for cross-validation")
        return 1

    def cv_mae(X, y, rng):
        perm = {g: rng.random() for g in set(groups)}
        g2 = np.array([perm[g] for g in groups])
        errs = np.empty_like(y)
        for tr, te in GroupKFold(n_splits=k).split(X, y, g2):
            m = make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-3, 3, 25)))
            m.fit(X[tr], y[tr])
            errs[te] = np.abs(m.predict(X[te]) - y[te])
        return errs.mean()

    rng = np.random.default_rng(seed)
    base = np.mean([cv_mae(Xh, y, rng) for _ in range(repeats)])
    full = np.mean([cv_mae(Xf, y, rng) for _ in range(repeats)])
    gain = 1 - full / base
    null_gains = []
    for _ in tqdm(range(null), desc="permutation null", unit="perm"):
        Xp = Xf.copy()
        Xp[:, len(hyper):] = Xp[rng.permutation(len(y)), len(hyper):]
        null_gains.append(1 - cv_mae(Xp, y, rng) / base)
    p = (1 + sum(g >= gain for g in null_gains)) / (1 + len(null_gains))
    log(f"  CV MAE hyper-only     : {base:.5g}")
    log(f"  CV MAE hyper+features : {full:.5g}")
    log(f"  relative gain         : {gain:+.1%}   (permutation p = {p:.3f}, {len(null_gains)} perms)")
    log(f"  pre-registered bar    : {bar:.0%}  ->  {'PASSES' if gain >= bar and p < 0.05 else 'does not pass'} (exploratory)")
    return 0
