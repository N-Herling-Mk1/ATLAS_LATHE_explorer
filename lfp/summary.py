"""Turn fingerprint documents into one row per run (the table the site and killtest use)."""
from __future__ import annotations

import json
from pathlib import Path

from .log import log


def final_snapshot(doc):
    snaps = doc.get("snapshots", [])
    fin = [s for s in snaps if s.get("epoch") == "final"]
    return fin[-1] if fin else (snaps[-1] if snaps else None)


def summarize(docs, pairs, ledger=None, key="name"):
    """One row per run. Columns:
      meta_*   run metadata          loss_*   loss values (NOT geometric; excluded from killtest)
      geo_*    final-state geometry  traj_*   geometry at recorded training epochs
      led_*    your ledger columns (metrics)
    """
    import numpy as np
    import pandas as pd

    rows = []
    barrier_by_run = {}
    for p in pairs:
        for r in (p["a"], p["b"]):
            barrier_by_run.setdefault(r, []).append(p["barrier"])
    for d in docs:
        row = {"run_id": d["run_id"], "source": d.get("source")}
        for k, v in (d.get("meta") or {}).items():
            row[f"meta_{k}"] = v
        s = final_snapshot(d)
        if s:
            for k, v in (s.get("losses") or {}).items():
                row[f"loss_{k}"] = v
            row["loss_total"] = s.get("total")
            c = s.get("conflict") or {}
            if c:
                row["geo_cos_global"] = c.get("global")
                for i, ln in enumerate(c.get("layer_order", [])):
                    row[f"geo_cos_L{i}"] = c["per_layer"].get(ln)
                    if c.get("cancel"):
                        row[f"geo_kappa_L{i}"] = c["cancel"].get(ln)
                        row[f"geo_rho_L{i}"] = c["balance"].get(ln)
            h = s.get("hessian") or {}
            row["geo_lam_max"] = h.get("lam_max")
            row["geo_lam_min"] = h.get("lam_min")
            t = s.get("trace") or {}
            row["geo_trace"] = t.get("trace")
            sl = (s.get("slice") or {}).get("summary") or {}
            for k in ("rise", "width", "rough"):
                if k in sl:
                    row[f"geo_slice_{k}"] = sl[k]
            dc = s.get("dcor") or {}
            if dc:
                row["geo_dcor_gap"] = dc.get("gap")
                row["dcor_mini"] = dc.get("mini_mean")
                row["dcor_full"] = dc.get("full")
        for snap in d.get("snapshots", []):
            e = snap.get("epoch")
            if e == "final":
                continue
            row[f"traj_lam_max_e{e}"] = (snap.get("hessian") or {}).get("lam_max")
            row[f"traj_lam_min_e{e}"] = (snap.get("hessian") or {}).get("lam_min")
            row[f"traj_cos_global_e{e}"] = (snap.get("conflict") or {}).get("global")
            row[f"traj_trace_e{e}"] = (snap.get("trace") or {}).get("trace")
            cc = snap.get("conflict") or {}
            if cc.get("cancel"):
                ks = [v for v in cc["cancel"].values() if v is not None]
                row[f"traj_kappa_min_e{e}"] = min(ks) if ks else None
        if d["run_id"] in barrier_by_run:
            row["geo_barrier_mean"] = float(np.mean(barrier_by_run[d["run_id"]]))
        rows.append(row)
    df = pd.DataFrame(rows)
    if ledger is not None and len(df):
        led = ledger.rename(columns={c: f"led_{c}" for c in ledger.columns if c != key})
        df = df.merge(led, how="left", left_on="run_id", right_on=key)
        n_hit = df[[c for c in df.columns if c.startswith("led_")]].notna().any(axis=1).sum()
        log(f"ledger join on '{key}': matched {n_hit}/{len(df)} runs")
        if key in df.columns and key != "run_id":
            df = df.drop(columns=[key])
    return df


def load_fingerprints(fp_dirs):
    """Read every */fingerprint.json and pairs.json under the given dirs. Later dirs win on duplicate run_id."""
    docs, pairs = [], []
    for d in fp_dirs:
        d = Path(d)
        for f in sorted(d.glob("*/fingerprint.json")):
            docs.append(json.loads(f.read_text()))
        pf = d / "pairs.json"
        if pf.exists():
            pairs.extend(json.loads(pf.read_text()).get("pairs", []))
    seen, uniq = set(), []
    for doc in reversed(docs):  # later dirs win on duplicate run_id
        if doc["run_id"] not in seen:
            seen.add(doc["run_id"])
            uniq.append(doc)
    return list(reversed(uniq)), pairs


def json_safe(o):
    import math

    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: json_safe(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [json_safe(v) for v in o]
    return o
