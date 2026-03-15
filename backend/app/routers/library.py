"""Image Library — external read-only library + per-user custom images management."""
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from ..models import User
from ..config import get_settings

router = APIRouter(prefix="/api/library", tags=["library"])
settings = get_settings()

_IMAGE_EXTS = {'.img', '.ima', '.vfd', '.flp', '.iso', '.bin', '.cue', '.mdf', '.nrg'}


def _ext_type(name: str) -> str:
    ext = os.path.splitext(name)[1].lower()
    if ext in {'.img', '.ima', '.vfd', '.flp'}:
        return 'floppy'
    if ext in {'.iso', '.bin', '.cue', '.mdf', '.nrg'}:
        return 'cdrom'
    return 'other'


def _build_tree(root: str) -> list:
    """Recursively build a read-only library tree (skips empty directories)."""
    entries = []
    try:
        items = sorted(os.scandir(root), key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))
    except PermissionError:
        return entries

    for item in items:
        if item.is_dir(follow_symlinks=False):
            children = _build_tree(item.path)
            if children:
                entries.append({"name": item.name, "type": "directory", "children": children})
        elif item.is_file(follow_symlinks=False):
            ext = os.path.splitext(item.name)[1].lower()
            if ext in _IMAGE_EXTS:
                entries.append({
                    "name": item.name, "type": "file",
                    "size": item.stat(follow_symlinks=False).st_size,
                    "image_type": _ext_type(item.name),
                })
    return entries


def _build_writable_tree(root: str) -> list:
    """Recursively build a user images tree (includes empty directories)."""
    entries = []
    try:
        items = sorted(os.scandir(root), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return entries

    for item in items:
        if item.name.startswith('.'):
            continue
        if item.is_dir():
            children = _build_writable_tree(item.path)
            entries.append({"name": item.name, "type": "directory", "children": children})
        elif item.is_file():
            ext = os.path.splitext(item.name)[1].lower()
            if ext in _IMAGE_EXTS:
                entries.append({
                    "name": item.name, "type": "file",
                    "size": item.stat().st_size,
                    "image_type": _ext_type(item.name),
                })
    return entries


def _user_images_dir(user: User) -> str:
    return settings.user_images_path(user.id)


def _safe_path(base: str, rel: str) -> str:
    """Validate a relative path is within base and return its absolute path."""
    clean = os.path.normpath(rel.strip("/"))
    if clean == "." or clean.startswith(".."):
        raise HTTPException(400, "Invalid path")
    full = os.path.join(base, clean)
    if not os.path.abspath(full).startswith(os.path.abspath(base) + os.sep):
        raise HTTPException(400, "Invalid path")
    return full


# ─── Read-only library tree ───────────────────────────────────────────────────

@router.get("/")
async def get_library(current_user: User = Depends(get_current_user)):
    lib = settings.library_path
    if not os.path.isdir(lib):
        return []
    return _build_tree(lib)


# ─── User images tree ─────────────────────────────────────────────────────────

@router.get("/images/tree")
async def get_images_tree(current_user: User = Depends(get_current_user)):
    images_dir = _user_images_dir(current_user)
    if not os.path.isdir(images_dir):
        return []
    return _build_writable_tree(images_dir)


# ─── Create directory ─────────────────────────────────────────────────────────

class MkdirBody(BaseModel):
    path: str


@router.post("/images/mkdir", status_code=201)
async def create_images_directory(
    body: MkdirBody,
    current_user: User = Depends(get_current_user),
):
    images_dir = _user_images_dir(current_user)
    os.makedirs(images_dir, exist_ok=True)
    full = _safe_path(images_dir, body.path)
    if os.path.exists(full):
        raise HTTPException(409, "Already exists")
    os.makedirs(full)
    return {"path": body.path}


# ─── Upload image ─────────────────────────────────────────────────────────────

@router.post("/images/upload", status_code=201)
async def upload_image(
    file: UploadFile = File(...),
    path: str = Form(""),
    current_user: User = Depends(get_current_user),
):
    images_dir = _user_images_dir(current_user)
    target_dir = _safe_path(images_dir, path) if path.strip("/") else images_dir
    os.makedirs(target_dir, exist_ok=True)

    safe_name = os.path.basename(file.filename or "upload")
    if not safe_name:
        raise HTTPException(400, "Invalid filename")
    dest = os.path.join(target_dir, safe_name)
    if os.path.exists(dest):
        raise HTTPException(409, f"'{safe_name}' already exists")

    with open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)

    return {"name": safe_name, "size": os.path.getsize(dest), "image_type": _ext_type(safe_name)}


# ─── Delete file or empty directory ──────────────────────────────────────────

@router.delete("/images/{rel_path:path}", status_code=204)
async def delete_image(
    rel_path: str,
    current_user: User = Depends(get_current_user),
):
    images_dir = _user_images_dir(current_user)
    full = _safe_path(images_dir, rel_path)

    if os.path.isdir(full):
        try:
            os.rmdir(full)
        except OSError:
            raise HTTPException(409, "Directory is not empty")
    elif os.path.isfile(full):
        os.remove(full)
    else:
        raise HTTPException(404, "Not found")


# ─── Move / rename ────────────────────────────────────────────────────────────

class MoveBody(BaseModel):
    src: str   # relative source path
    dst: str   # relative destination path (file or directory)


@router.post("/images/move", status_code=200)
async def move_image(
    body: MoveBody,
    current_user: User = Depends(get_current_user),
):
    images_dir = _user_images_dir(current_user)
    src_full = _safe_path(images_dir, body.src)
    dst_full = _safe_path(images_dir, body.dst)

    if not os.path.exists(src_full):
        raise HTTPException(404, "Source not found")
    # If dst is an existing directory, move src INTO it
    if os.path.isdir(dst_full):
        dst_full = os.path.join(dst_full, os.path.basename(src_full))
    if os.path.exists(dst_full):
        raise HTTPException(409, "Destination already exists")
    os.makedirs(os.path.dirname(dst_full), exist_ok=True)
    os.rename(src_full, dst_full)
    return {"src": body.src, "dst": body.dst}
