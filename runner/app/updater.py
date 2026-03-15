"""
Download the latest 86Box binary and ROMs from GitHub.
Checks on startup and can be triggered via API.
"""
import os
import json
import tarfile
import zipfile
import shutil
import logging
import hashlib
import httpx
import asyncio

from .config import get_settings

log = logging.getLogger("86web.updater")
settings = get_settings()

GITHUB_API = "https://api.github.com"
BOX86_REPO = "86Box/86Box"
ROMS_REPO = "86Box/roms"


def _version_file(name: str) -> str:
    return os.path.join(settings.cache_path, f"{name}.version")


def _read_version(name: str) -> str:
    path = _version_file(name)
    if os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    return ""


def _write_version(name: str, version: str):
    os.makedirs(settings.cache_path, exist_ok=True)
    with open(_version_file(name), "w") as f:
        f.write(version)


async def get_latest_release(repo: str) -> dict:
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "86Web/1.0"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{GITHUB_API}/repos/{repo}/releases/latest", headers=headers)
        r.raise_for_status()
        return r.json()


async def check_86box_update() -> dict:
    """Returns dict with version, latest, update_available."""
    installed = _read_version("86box")
    try:
        release = await get_latest_release(BOX86_REPO)
        latest = release.get("tag_name", "")
        # Use pinned version if set
        if settings.box86_version:
            latest = settings.box86_version
        return {
            "version": installed or None,
            "latest": latest,
            "update_available": bool(latest and installed != latest),
            "release": release,
        }
    except Exception as e:
        log.warning("Could not check 86Box updates: %s", e)
        return {"version": installed or None, "latest": None, "update_available": False}


async def check_roms_update() -> dict:
    installed = _read_version("roms")
    try:
        release = await get_latest_release(ROMS_REPO)
        latest = release.get("tag_name", "")
        return {
            "roms_version": installed or None,
            "roms_latest": latest,
            "roms_update_available": bool(latest and installed != latest),
            "release": release,
        }
    except Exception as e:
        log.warning("Could not check ROMs updates: %s", e)
        return {"roms_version": installed or None, "roms_latest": None, "roms_update_available": False}


async def download_86box(release: dict = None) -> bool:
    """Download and install 86Box binary. Returns True on success."""
    try:
        if not release:
            release = await get_latest_release(BOX86_REPO)

        tag = release["tag_name"]
        if settings.box86_version:
            tag = settings.box86_version

        # Find the right asset
        arch = settings.box86_arch
        arch_map = {"x86_64": "x86_64", "aarch64": "arm64"}
        arch_str = arch_map.get(arch, "x86_64")

        # Look for Linux binary
        asset_url = None
        asset_name = None
        for asset in release.get("assets", []):
            name = asset["name"].lower()
            if "linux" in name and arch_str.lower() in name and name.endswith(".tar.gz"):
                asset_url = asset["browser_download_url"]
                asset_name = asset["name"]
                break
            # Also check for AppImage
            if "linux" in name and arch_str.lower() in name and name.endswith(".appimage"):
                asset_url = asset["browser_download_url"]
                asset_name = asset["name"]
                break

        if not asset_url:
            log.error("No suitable 86Box binary found for Linux/%s in release %s", arch, tag)
            # Try to find any Linux asset
            for asset in release.get("assets", []):
                if "linux" in asset["name"].lower():
                    asset_url = asset["browser_download_url"]
                    asset_name = asset["name"]
                    log.warning("Falling back to: %s", asset_name)
                    break

        if not asset_url:
            log.error("No Linux 86Box asset found at all.")
            return False

        log.info("Downloading 86Box %s: %s", tag, asset_name)
        os.makedirs(settings.cache_path, exist_ok=True)
        download_path = os.path.join(settings.cache_path, asset_name)

        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            async with client.stream("GET", asset_url) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                if total:
                    log.info("86Box download size: %.1f MB", total / 1_048_576)
                received = 0
                last_logged_mb = 0
                with open(download_path, "wb") as f:
                    async for chunk in r.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                        received += len(chunk)
                        mb = received // 1_048_576
                        if mb >= last_logged_mb + 10:
                            last_logged_mb = mb
                            if total:
                                log.info("86Box: downloaded %d / %d MB (%.0f%%)",
                                         mb, total // 1_048_576, received / total * 100)
                            else:
                                log.info("86Box: downloaded %d MB…", mb)
        log.info("86Box download complete (%.1f MB), extracting…", received / 1_048_576)

        # Extract / install
        os.makedirs(settings.box86_dir, exist_ok=True)

        if asset_name.endswith(".tar.gz"):
            with tarfile.open(download_path, "r:gz") as tar:
                tar.extractall(settings.box86_dir)
            # Find the 86Box binary
            for root, dirs, files in os.walk(settings.box86_dir):
                for fname in files:
                    if fname == "86Box":
                        src = os.path.join(root, fname)
                        dst = settings.box86_bin
                        shutil.move(src, dst)
                        os.chmod(dst, 0o755)
                        break

        elif asset_name.endswith(".AppImage"):
            dst = settings.box86_bin
            shutil.move(download_path, dst)
            os.chmod(dst, 0o755)
            # Pre-extract the AppImage so we can exec the binary directly,
            # avoiding the two-process AppImage launcher + child structure.
            extracted_dir = os.path.join(settings.box86_dir, "extracted")
            shutil.rmtree(extracted_dir, ignore_errors=True)
            squashfs_root = os.path.join(settings.box86_dir, "squashfs-root")
            shutil.rmtree(squashfs_root, ignore_errors=True)
            try:
                import subprocess as _sp
                _sp.run([dst, "--appimage-extract"], cwd=settings.box86_dir,
                        env={**os.environ, "APPIMAGE_EXTRACT_AND_RUN": "1"},
                        timeout=60, check=True, capture_output=True)
                os.rename(squashfs_root, extracted_dir)
                log.info("86Box AppImage pre-extracted to %s", extracted_dir)
            except Exception as ex:
                log.warning("86Box AppImage extraction failed (will use AppImage directly): %s", ex)
                shutil.rmtree(extracted_dir, ignore_errors=True)

        _write_version("86box", tag)
        log.info("86Box %s installed at %s", tag, settings.box86_bin)
        return True

    except Exception as e:
        log.error("Failed to download 86Box: %s", e)
        return False


async def download_roms(release: dict = None) -> bool:
    """Download and install 86Box ROMs."""
    try:
        if not release:
            release = await get_latest_release(ROMS_REPO)

        tag = release["tag_name"]
        roms_path = settings.roms_path
        os.makedirs(roms_path, exist_ok=True)

        # Prefer a zip asset, fall back to the release tarball_url
        asset_url = None
        asset_name = None
        for asset in release.get("assets", []):
            if asset["name"].endswith(".zip"):
                asset_url = asset["browser_download_url"]
                asset_name = asset["name"]
                break

        if not asset_url:
            asset_url = release.get("tarball_url")
            asset_name = f"roms-{tag}.tar.gz"

        if not asset_url:
            log.error("No ROMs asset found")
            return False

        log.info("Downloading ROMs %s: %s", tag, asset_name)
        download_path = os.path.join(settings.cache_path, asset_name)

        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            async with client.stream("GET", asset_url) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                if total:
                    log.info("ROMs download size: %.1f MB", total / 1_048_576)
                received = 0
                last_logged_mb = 0
                with open(download_path, "wb") as f:
                    async for chunk in r.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                        received += len(chunk)
                        mb = received // 1_048_576
                        if mb >= last_logged_mb + 10:
                            last_logged_mb = mb
                            if total:
                                log.info("ROMs: downloaded %d / %d MB (%.0f%%)",
                                         mb, total // 1_048_576, received / total * 100)
                            else:
                                log.info("ROMs: downloaded %d MB…", mb)
        log.info("ROMs download complete (%.1f MB), extracting…", received / 1_048_576)

        # Extract to roms_path
        extract_tmp = os.path.join(settings.cache_path, "roms_extract")
        if os.path.exists(extract_tmp):
            shutil.rmtree(extract_tmp)
        os.makedirs(extract_tmp)

        if asset_name.endswith(".tar.gz"):
            with tarfile.open(download_path, "r:gz") as t:
                t.extractall(extract_tmp)
        else:
            with zipfile.ZipFile(download_path, "r") as z:
                z.extractall(extract_tmp)

        # Move contents to roms_path
        extracted = os.listdir(extract_tmp)
        if len(extracted) == 1 and os.path.isdir(os.path.join(extract_tmp, extracted[0])):
            src = os.path.join(extract_tmp, extracted[0])
        else:
            src = extract_tmp

        for item in os.listdir(src):
            s = os.path.join(src, item)
            d = os.path.join(roms_path, item)
            if os.path.exists(d):
                if os.path.isdir(d):
                    shutil.rmtree(d)
                else:
                    os.remove(d)
            shutil.move(s, d)

        shutil.rmtree(extract_tmp, ignore_errors=True)
        _write_version("roms", tag)
        log.info("ROMs %s installed at %s", tag, roms_path)
        return True

    except Exception as e:
        log.error("Failed to download ROMs: %s", e)
        return False


async def startup_update_check():
    """Called on runner startup — downloads 86Box and ROMs if not present or outdated."""
    log.info("Checking for 86Box updates…")
    box_info = await check_86box_update()
    roms_info = await check_roms_update()

    bin_exists = os.path.exists(settings.box86_bin)
    log.info("86Box: installed=%s, latest=%s, binary_exists=%s",
             box_info.get("version") or "none",
             box_info.get("latest") or "unknown",
             bin_exists)

    needs_box = box_info.get("update_available") or not bin_exists
    needs_roms = roms_info.get("roms_update_available") or not any(os.scandir(settings.roms_path)) if os.path.exists(settings.roms_path) else True

    tasks = []
    if needs_box:
        reason = "update available" if box_info.get("update_available") else "binary not found"
        log.info("Downloading 86Box %s… (reason: %s)", box_info.get("latest"), reason)
        tasks.append(download_86box(box_info.get("release")))
    if needs_roms:
        log.info("Downloading ROMs %s…", roms_info.get("roms_latest"))
        tasks.append(download_roms(roms_info.get("release")))

    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        failed = []
        for r in results:
            if isinstance(r, Exception):
                log.error("Update task failed: %s", r)
                failed.append(r)
        if failed:
            log.warning("Startup update finished with %d failure(s).", len(failed))
        else:
            log.info("Startup update complete — all downloads succeeded.")
    else:
        log.info("86Box and ROMs are up to date.")
