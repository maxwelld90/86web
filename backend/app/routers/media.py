"""Shared/pooled media library — user-level media files shared across all VMs."""
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from ..auth import get_current_user
from ..models import User
from ..config import get_settings

router = APIRouter(prefix="/api/media", tags=["media"])
settings = get_settings()


def _shared_media_dir(user_id: int) -> str:
    """Returns the user-level shared media directory path."""
    return settings.shared_media_path(user_id)


@router.get("/")
async def list_shared_media(
    current_user: User = Depends(get_current_user),
):
    """List files in the user's shared media pool."""
    mdir = _shared_media_dir(current_user.id)
    if not os.path.exists(mdir):
        return []
    files = []
    for name in sorted(os.listdir(mdir)):
        fp = os.path.join(mdir, name)
        if os.path.isfile(fp):
            files.append({"name": name, "size": os.path.getsize(fp), "path": fp})
    return files


@router.post("/")
async def upload_shared_media(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a file to the user's shared media pool."""
    mdir = _shared_media_dir(current_user.id)
    os.makedirs(mdir, exist_ok=True)
    safe_name = os.path.basename(file.filename or "upload")
    if not safe_name:
        raise HTTPException(400, "Invalid filename")
    dest = os.path.join(mdir, safe_name)
    with open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)
    return {"name": safe_name, "size": os.path.getsize(dest), "path": dest}


@router.delete("/{filename}", status_code=204)
async def delete_shared_media(
    filename: str,
    current_user: User = Depends(get_current_user),
):
    """Delete a file from the user's shared media pool."""
    mdir = _shared_media_dir(current_user.id)
    safe_name = os.path.basename(filename)
    fp = os.path.join(mdir, safe_name)
    if not os.path.abspath(fp).startswith(os.path.abspath(mdir)):
        raise HTTPException(400, "Invalid path")
    if not os.path.exists(fp):
        raise HTTPException(404, "File not found")
    os.remove(fp)
