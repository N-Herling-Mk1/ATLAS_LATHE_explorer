"""Training-time hook: records fingerprints at fixed epochs.

Usage inside your training loop (one recorder per run):

    from lfp.recorder import FingerprintRecorder
    rec = FingerprintRecorder("fp_out", run_id, meta, epochs=(1, 5, 10, 20))
    for epoch in range(1, n_epochs + 1):
        train_one_epoch(...)
        rec.on_epoch_end(epoch, make_handle(model))   # no-op on unscheduled epochs
    rec.on_train_end(make_handle(best_model))         # final snapshot + slices, saves weights

make_handle(model) builds a RunHandle around the live model (see adapters/TEMPLATE.py).
The recorder never steps the optimizer or changes weights. It does consume
CPU/GPU time, and it touches torch's global RNG only through its own
generators, so it must not change your training trajectory -- verify that
once with your bit-for-bit check (train with and without the recorder).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import torch

from .adapter import RunHandle, batch_fingerprint
from .probes import PROBES_DURING_TRAINING, PROBES_FINAL, snapshot

SCHEMA = "lfp/1"


def _log(msg: str):
    print(f"[{time.strftime('%H:%M:%S')}] lfp: {msg}", flush=True)


class FingerprintRecorder:
    def __init__(self, out_root, run_id: str, meta: dict, epochs=(1, 5, 10, 20),
                 probes=PROBES_DURING_TRAINING, final_probes=PROBES_FINAL, cfg: dict | None = None,
                 save_state: bool = True, verbose: bool = True):
        self.dir = Path(out_root) / run_id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.run_id, self.meta = run_id, dict(meta)
        self.epochs = set(int(e) for e in epochs)
        self.probes, self.final_probes = tuple(probes), tuple(final_probes)
        self.cfg = cfg or {}
        self.save_state, self.verbose = save_state, verbose
        self.doc = {"schema": SCHEMA, "run_id": run_id, "meta": self.meta, "source": "training",
                    "snapshots": [], "created": time.strftime("%Y-%m-%dT%H:%M:%S")}

    def on_epoch_end(self, epoch: int, handle: RunHandle):
        if int(epoch) not in self.epochs:
            return None
        return self._take(epoch, handle, self.probes)

    def on_train_end(self, handle: RunHandle, final_metrics: dict | None = None):
        snap = self._take("final", handle, self.final_probes)
        if final_metrics:
            self.doc["final_metrics"] = final_metrics
        if self.save_state:
            path = self.dir / "final_state.pt"
            torch.save(handle.model.state_dict(), path)
            self.doc["state_path"] = str(path)
        self.doc["probe_batch_hash"] = batch_fingerprint(handle.probe_batch)
        self._write()
        return snap

    def _take(self, epoch, handle, probes):
        rng_before = torch.random.get_rng_state().clone()
        t0 = time.perf_counter()
        snap = snapshot(handle, epoch, probes, self.cfg)
        if not torch.equal(torch.random.get_rng_state(), rng_before):
            torch.random.set_rng_state(rng_before)
            snap["warning"] = "probe touched global RNG; state restored"
        self.doc["snapshots"].append(snap)
        self._write()
        if self.verbose:
            hs = snap.get("hessian") or {}
            lam, lmin = hs.get("lam_max"), hs.get("lam_min")
            c = (snap.get("conflict") or {}).get("global")
            nan = float("nan")
            _log(f"{self.run_id} epoch {epoch}: total={snap['total']:.4f} "
                 f"lam_max={lam if lam is not None else nan:.4g} lam_min={lmin if lmin is not None else nan:.4g} "
                 f"cos={c if c is not None else nan:+.3f} ({time.perf_counter() - t0:.1f}s)")
        return snap

    def _write(self):
        tmp = self.dir / "fingerprint.json.tmp"
        tmp.write_text(json.dumps(self.doc, indent=1))
        tmp.replace(self.dir / "fingerprint.json")
