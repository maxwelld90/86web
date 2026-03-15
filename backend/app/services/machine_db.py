"""
86Box hardware database orchestrator.

Replaces hw_extractor.py. Downloads the 86Box source from GitHub and runs
parse_86box.py to generate the hardware database JSON.

Auto-refresh flow:
  1. On startup, schedule a background refresh if the database is missing/stale.
  2. Refresh downloads the 86Box source tarball from GitHub, extracts src/,
     runs parse_86box.py, and saves the result to the config directory.
  3. hardware_lists.py reads the config directory (lru_cache-backed).
"""

import asyncio
import io
import logging
import sys
import tarfile
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger("86web.machine_db")

# Re-download / re-parse if database is older than 7 days
CACHE_MAX_AGE_SECONDS = 7 * 24 * 3600

# One parse at a time
_refresh_lock = asyncio.Lock()


async def refresh_hardware_json(
    config_dir: Path, cache_dir: Path, force: bool = False
) -> Optional[Path]:
    """
    Download 86Box source from GitHub and regenerate hardware database.

    The generated JSON is written to config_dir; the source tarball is
    extracted under cache_dir/_86box_src (transient, large files).

    Returns the path to the generated JSON on success, None on failure.
    Never raises — all errors are logged.
    """
    async with _refresh_lock:
        config_dir.mkdir(parents=True, exist_ok=True)
        cache_dir.mkdir(parents=True, exist_ok=True)
        out_path = config_dir / "86box_hardware_db.json"

        if not force and out_path.exists():
            age = time.time() - out_path.stat().st_mtime
            if age < CACHE_MAX_AGE_SECONDS:
                log.info(
                    "Hardware DB cache is fresh (%.1f days old). Skipping refresh.",
                    age / 86400,
                )
                return out_path

        log.info("Downloading 86Box source from GitHub…")
        src_dir = await _download_86box_source(cache_dir)
        if src_dir is None:
            return None

        log.info("Running parse_86box.py → %s", out_path)
        success = await _run_parse(src_dir, out_path)
        if not success:
            return None

        log.info("Hardware database ready: %s (%.1f KB)", out_path, out_path.stat().st_size / 1024)
        return out_path


async def _download_86box_source(cache_dir: Path) -> Optional[Path]:
    """
    Download the 86Box master tarball from GitHub and extract only src/.
    Returns the path to the extracted src/ directory, or None on failure.
    """
    import httpx

    tarball_url = "https://codeload.github.com/86Box/86Box/tar.gz/refs/heads/master"
    extract_dir = cache_dir / "_86box_src"

    try:
        log.info("Fetching %s", tarball_url)
        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            resp = await client.get(tarball_url)
            resp.raise_for_status()
            data = resp.content

        log.info("Downloaded %.1f MB, extracting src/ …", len(data) / 1024 ** 2)

        def _extract(data: bytes, dest: Path) -> Path:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
                # Identify the top-level prefix (e.g. "86Box-master/")
                names = tar.getnames()
                prefix = names[0].split("/")[0] + "/" if names else ""
                # Extract only src/ files
                members = [
                    m for m in tar.getmembers()
                    if m.name.startswith(prefix + "src/") and m.isfile()
                ]
                dest.mkdir(parents=True, exist_ok=True)
                for member in members:
                    member.name = member.name[len(prefix):]  # strip top-level dir
                    tar.extract(member, path=dest, filter="data")
            return dest / "src"

        src_dir = await asyncio.to_thread(_extract, data, extract_dir)

        if not src_dir.exists():
            log.error("src/ directory not found after extraction in %s", extract_dir)
            return None

        log.info("Extracted %d C source files.", len(list(src_dir.rglob("*.c"))))
        return src_dir

    except Exception:
        log.exception("Failed to download or extract 86Box source")
        return None


async def _run_parse(src_dir: Path, out_path: Path) -> bool:
    """Run parse_86box.py as a subprocess. Returns True on success."""
    parse_script = Path(__file__).parent / "parse_86box.py"

    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        str(parse_script),
        "--src", str(src_dir),
        "--out", str(out_path),
        "--pretty",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        log.error(
            "parse_86box.py exited with code %d:\n%s",
            proc.returncode,
            stderr.decode(errors="replace"),
        )
        return False

    if stdout:
        log.debug("parse_86box.py output: %s", stdout.decode(errors="replace").strip())
    return True
