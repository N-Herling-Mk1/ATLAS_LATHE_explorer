"""End-to-end smoke test: train -> record -> probe -> pairs -> build-site -> killtest.

    python examples/smoke_sklearn/run_smoke.py            (about 1-3 minutes on a laptop CPU)

Then open smoke_out/site/index.html. Delete examples/ and smoke_out/ whenever
you like; nothing in lfp depends on them.
"""
import csv
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(HERE))

from lfp.cli import main as lfp  # noqa: E402
from lfp.recorder import FingerprintRecorder  # noqa: E402
from model import train_run  # noqa: E402

OUT = REPO / "smoke_out"
ALPHAS = (0.0, 4.0, 16.0)
SEEDS = (1, 2, 3, 4)


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] smoke: {m}", flush=True)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    runs_dir, fp_train, fp_ckpt = OUT / "runs", OUT / "fp_train", OUT / "fp_ckpt"
    log("equivalence check: the recorder must not change training (bit for bit)")
    import torch
    train_run(OUT / "eq_plain", 16.0, 1)
    train_run(OUT / "eq_rec", 16.0, 1, recorder_factory=lambda rid, meta: FingerprintRecorder(
        OUT / "eq_fp", rid, meta, epochs=(1, 5, 10, 20), verbose=False))
    sa = torch.load(OUT / "eq_plain" / "smoke_a16_s1" / "model.pt")
    sb = torch.load(OUT / "eq_rec" / "smoke_a16_s1" / "model.pt")
    same = all(torch.equal(sa[k], sb[k]) for k in sa)
    log(f"equivalence: {'IDENTICAL' if same else 'DIFFERENT -- recorder perturbs training'}")
    assert same
    for d in ("eq_plain", "eq_rec", "eq_fp"):
        shutil.rmtree(OUT / d)
    jobs = [(a, s) for a in ALPHAS for s in SEEDS]
    rows = []
    for i, (a, s) in enumerate(jobs, 1):
        log(f"[{i}/{len(jobs)}] training alpha={a:g} seed={s}")
        rid, meta, met = train_run(
            runs_dir, a, s,
            recorder_factory=lambda rid, meta: FingerprintRecorder(fp_train, rid, meta, epochs=(1, 5, 10, 20),
                                                                   cfg={"hess_iters": 30, "trace_samples": 16}))
        rows.append({"name": rid, **met})
    with open(OUT / "ledger.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    log("post-hoc probe of the saved checkpoints (same probes, no training)")
    adapter = str(HERE / "adapter.py")
    assert lfp(["probe", "--adapter", adapter, "--runs", str(runs_dir), "--out", str(fp_ckpt),
                "--trace-samples", "16"]) == 0
    log("seed-pair barriers")
    assert lfp(["pairs", "--adapter", adapter, "--runs", str(runs_dir), "--out", str(fp_train),
                "--group-by", "cell,fold"]) == 0
    log("build site")
    assert lfp(["build-site", "--fp", str(fp_train), "--ledger", str(OUT / "ledger.csv"), "--key", "name",
                "--out", str(OUT / "site"), "--title", "lfp smoke test (sklearn breast cancer stand-in)",
                "--clean"]) == 0
    log("exploratory killtest (target: background dCor on validation)")
    lfp(["killtest", "--summary", str(OUT / "site" / "data" / "fp_summary.csv"), "--target", "led_dcor_bg",
         "--hyper", "meta_alpha", "--null", "100", "--repeats", "10"])
    log(f"done. open {OUT / 'site' / 'index.html'}")


if __name__ == "__main__":
    main()
