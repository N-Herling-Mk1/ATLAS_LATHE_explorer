"""Command line: python -m lfp <command> ...

  probe       fingerprint saved checkpoints (no training)
  pairs       seed-pair interpolation barriers + prediction distance
  build-site  aggregate fingerprints (+ your ledger) into the static site
  killtest    exploratory: do geometric features predict a metric beyond hyperparameters?
"""
from __future__ import annotations

import argparse
import itertools
import json
import sys
import time
from pathlib import Path

from tqdm import tqdm

from .killtest import killtest
from .log import log
from .site_build import build_site


def _parse_filters(items):
    out = {}
    for it in items or []:
        k, _, v = it.partition("=")
        out[k] = v
    return out


def _meta_match(meta, filters):
    return all(str(meta.get(k)) == v for k, v in filters.items())


def _cfg_from(args):
    return {"hess_iters": args.hess_iters, "trace_samples": args.trace_samples,
            "slice_dirs": args.slice_dirs, "slice_points": args.slice_points,
            "slice_span": args.slice_span, "dcor_full": args.dcor_full}


# --------------------------------------------------------------------------- probe
def cmd_probe(args):
    from .adapter import batch_fingerprint, load_adapter
    from .probes import PROBES_FINAL, snapshot
    from .recorder import SCHEMA

    ad = load_adapter(args.adapter)
    runs = list(ad.list_runs(args.runs))
    filters = _parse_filters(args.filter)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    probes = tuple(args.probes.split(",")) if args.probes else PROBES_FINAL
    log(f"probe: {len(runs)} runs found under {args.runs}; probes={','.join(probes)}; out={out}")
    done = skipped = failed = 0
    bar = tqdm(runs, desc="probing", unit="run")
    for run in bar:
        try:
            h = ad.load_run(run, args.device)
            if filters and not _meta_match(h.meta, filters):
                skipped += 1
                continue
            dest = out / h.run_id / "fingerprint.json"
            if args.skip_existing and dest.exists():
                skipped += 1
                continue
            bar.set_postfix_str(h.run_id[-40:])
            t0 = time.perf_counter()
            snap = snapshot(h, "final", probes, _cfg_from(args))
            doc = {"schema": SCHEMA, "run_id": h.run_id, "meta": h.meta, "source": "checkpoint",
                   "state_path": h.state_path, "probe_batch_hash": batch_fingerprint(h.probe_batch),
                   "snapshots": [snap], "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(doc, indent=1))
            hs = snap.get("hessian") or {}
            nan = float("nan")
            lmax, lmin = hs.get("lam_max"), hs.get("lam_min")
            log(f"  {h.run_id}: total={snap['total']:.4f} lam_max={lmax if lmax is not None else nan:.4g} "
                f"lam_min={lmin if lmin is not None else nan:.4g} "
                f"({time.perf_counter() - t0:.1f}s)")
            done += 1
        except Exception as e:  # keep going; report at the end
            failed += 1
            log(f"  FAILED {run}: {type(e).__name__}: {e}")
            if args.strict:
                raise
    log(f"probe: done={done} skipped={skipped} failed={failed}")
    return 1 if failed and args.strict else 0


# --------------------------------------------------------------------------- pairs
def cmd_pairs(args):
    from .adapter import load_adapter
    from .probes import interp_barrier, prediction_distance

    ad = load_adapter(args.adapter)
    runs = list(ad.list_runs(args.runs))
    filters = _parse_filters(args.filter)
    keys = [k for k in args.group_by.split(",") if k]
    log(f"pairs: reading metadata for {len(runs)} runs (group by {keys})")
    groups = {}
    for run in tqdm(runs, desc="metadata", unit="run"):
        meta = ad.run_meta(run) if hasattr(ad, "run_meta") else ad.load_run(run, "cpu").meta
        if filters and not _meta_match(meta, filters):
            continue
        groups.setdefault(tuple(str(meta.get(k)) for k in keys), []).append(run)
    results = []
    n_pairs = sum(min(len(list(itertools.combinations(v, 2))), args.max_pairs) for v in groups.values())
    log(f"pairs: {len(groups)} groups, {n_pairs} pairs")
    bar = tqdm(total=n_pairs, desc="barriers", unit="pair")
    for gkey, members in groups.items():
        handles = {r: ad.load_run(r, args.device) for r in members}
        for a, b in list(itertools.combinations(members, 2))[: args.max_pairs]:
            ha, hb = handles[a], handles[b]
            try:
                ib = interp_barrier(ha, hb, points=args.points)
                pd = prediction_distance(ha, hb)
                results.append({"group": dict(zip(keys, gkey)), "a": ha.run_id, "b": hb.run_id,
                                "barrier": ib["barrier"], "barrier_terms": ib["barrier_terms"],
                                "t": ib["t"], "curve": ib["total"], "pred": pd})
            except Exception as e:
                log(f"  FAILED pair {ha.run_id} x {hb.run_id}: {e}")
            bar.update(1)
        del handles
    bar.close()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "pairs.json").write_text(json.dumps({"schema": "lfp-pairs/1", "group_by": keys, "pairs": results}, indent=1))
    log(f"pairs: wrote {len(results)} pairs to {out / 'pairs.json'}")
    return 0


# --------------------------------------------------------------------------- summary table


# --------------------------------------------------------------------------- build-site


# --------------------------------------------------------------------------- killtest


# --------------------------------------------------------------------------- main
def cmd_build_site(args):
    return build_site(args.fp, out=args.out, ledger=args.ledger, key=args.key, title=args.title,
                      extra_pairs=args.pairs, clean=args.clean)


def cmd_killtest(args):
    return killtest(args.summary, args.target, args.hyper, features=args.features, exclude=args.exclude,
                    group=args.group, folds=args.folds, repeats=args.repeats, null=args.null, bar=args.bar,
                    seed=args.seed)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m lfp", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def probe_cfg(p):
        p.add_argument("--hess-iters", type=int, default=50)
        p.add_argument("--trace-samples", type=int, default=32)
        p.add_argument("--slice-dirs", type=int, default=3)
        p.add_argument("--slice-points", type=int, default=21)
        p.add_argument("--slice-span", type=float, default=1.0)
        p.add_argument("--dcor-full", type=int, default=4096)

    p = sub.add_parser("probe", help="fingerprint saved checkpoints")
    p.add_argument("--adapter", required=True)
    p.add_argument("--runs", required=True, help="root passed to adapter.list_runs()")
    p.add_argument("--out", required=True)
    p.add_argument("--probes", default=None, help="comma list from conflict,hessian,trace,dcor,slice")
    p.add_argument("--filter", action="append", help="meta key=value (repeatable)")
    p.add_argument("--device", default="cpu")
    p.add_argument("--skip-existing", action="store_true")
    p.add_argument("--strict", action="store_true", help="stop at the first failure")
    probe_cfg(p)
    p.set_defaults(fn=cmd_probe)

    p = sub.add_parser("pairs", help="seed-pair barriers")
    p.add_argument("--adapter", required=True)
    p.add_argument("--runs", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--group-by", default="cell,fold")
    p.add_argument("--max-pairs", type=int, default=45, help="per group")
    p.add_argument("--points", type=int, default=11)
    p.add_argument("--filter", action="append")
    p.add_argument("--device", default="cpu")
    p.set_defaults(fn=cmd_pairs)

    p = sub.add_parser("build-site", help="aggregate into the static site")
    p.add_argument("--fp", nargs="+", required=True, help="fingerprint dir(s)")
    p.add_argument("--pairs", nargs="*", help="extra pairs.json files")
    p.add_argument("--ledger", default=None, help="CSV of your run metrics")
    p.add_argument("--key", default="name", help="ledger column matching run_id")
    p.add_argument("--out", default="site_build")
    p.add_argument("--title", default="LATHE landscape fingerprints")
    p.add_argument("--clean", action="store_true")
    p.set_defaults(fn=cmd_build_site)

    p = sub.add_parser("killtest", help="exploratory feature-vs-hyperparameter comparison")
    p.add_argument("--summary", required=True, help="fp_summary.csv from build-site")
    p.add_argument("--target", required=True, help="e.g. led_pnc_wp")
    p.add_argument("--hyper", required=True, help="comma list, e.g. meta_alpha,meta_tau")
    p.add_argument("--features", default="geo_", help="column prefixes (default geometric only)")
    p.add_argument("--exclude", default=None, help="substrings to drop from features")
    p.add_argument("--group", default="meta_seed", help="CV grouping column")
    p.add_argument("--folds", type=int, default=5)
    p.add_argument("--repeats", type=int, default=20)
    p.add_argument("--null", type=int, default=200)
    p.add_argument("--bar", type=float, default=0.20)
    p.add_argument("--seed", type=int, default=0)
    p.set_defaults(fn=cmd_killtest)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
