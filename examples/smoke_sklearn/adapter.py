"""lfp adapter for the smoke-test runs (post-hoc probing of saved checkpoints)."""
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from model import MLP, load_data, make_handle  # noqa: E402

_DATA = None


def _data():
    global _DATA
    if _DATA is None:
        _DATA = load_data()
    return _DATA


def list_runs(root):
    return sorted(str(p.parent) for p in Path(root).glob("*/config.json"))


def run_meta(run):
    return json.loads((Path(run) / "config.json").read_text())["meta"]


def load_run(run, device="cpu"):
    run = Path(run)
    cfg = json.loads((run / "config.json").read_text())
    meta = cfg["meta"]
    tr, _va, pr = _data()
    model = MLP(tr["x"].shape[1])
    model.load_state_dict(torch.load(run / "model.pt", map_location=device))
    model.to(device)
    return make_handle(run.name, meta, model, pr, meta["n_disco"], state_path=str(run / "model.pt"))
