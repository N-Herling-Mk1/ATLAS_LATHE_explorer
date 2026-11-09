"""Timestamped status lines that cooperate with tqdm progress bars."""
import time

from tqdm import tqdm


def log(msg: str) -> None:
    tqdm.write(f"[{time.strftime('%H:%M:%S')}] {msg}")
