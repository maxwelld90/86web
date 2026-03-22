import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from .config import get_settings
from .database import engine, Base, SessionLocal
from .models import User, SystemSetting
from .auth import hash_password
from .routers import auth, vms, users, system, media, library

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger("86web")


def _migrate_db():
    """Apply incremental schema migrations for existing databases."""
    with engine.connect() as conn:
        # Add network_enabled to vm_groups (added in v2)
        try:
            conn.execute(
                __import__("sqlalchemy").text(
                    "ALTER TABLE vm_groups ADD COLUMN network_enabled BOOLEAN NOT NULL DEFAULT 0"
                )
            )
            conn.commit()
            log.info("Migration: added network_enabled column to vm_groups")
        except Exception:
            pass  # Column already exists



def _bootstrap_db():
    """Create tables and seed admin user on first run."""
    Base.metadata.create_all(bind=engine)
    _migrate_db()
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.is_admin == True).first()
        if not admin:
            log.info("First boot: creating admin user '%s'", settings.admin_username)
            admin = User(
                username=settings.admin_username,
                email=settings.admin_email,
                hashed_password=hash_password(settings.admin_password),
                is_admin=True,
                is_active=True,
                max_vms=settings.default_max_vms,
                max_storage_gb=settings.default_max_storage_gb,
            )
            db.add(admin)
            db.commit()
            log.info("Admin user created.")
    finally:
        db.close()


def _reset_stale_vm_status():
    """On startup, mark any non-stopped VMs as stopped.

    VM processes don't survive a backend/runner restart, so any VM left as
    'running' in the DB is stale and must be cleared.
    """
    from .models import VM
    from datetime import datetime
    db = SessionLocal()
    try:
        stale = db.query(VM).filter(VM.status != "stopped").all()
        if stale:
            log.info("Startup: resetting %d stale VM(s) to 'stopped'", len(stale))
            for vm in stale:
                vm.status = "stopped"
                vm.vnc_port = None
                vm.ws_port = None
                vm.last_stopped = datetime.utcnow()
            db.commit()
    finally:
        db.close()


async def _refresh_hardware_db():
    """Background task: keep the hardware database up to date.

    Downloads the latest 86Box source from GitHub and regenerates the
    hardware JSON if the cache is missing or older than 7 days.
    Runs asynchronously so it never blocks API startup.
    """
    import time
    from .services.machine_db import refresh_hardware_json

    config_dir = Path(settings.data_path) / "config"
    cache_dir  = Path(settings.data_path) / "cache"
    hw_json    = config_dir / "86box_hardware_db.json"

    if hw_json.exists():
        age_days = (time.time() - hw_json.stat().st_mtime) / 86400
        log.info("Hardware database found in config (age: %.1f days).", age_days)
    else:
        log.info("Hardware database not in config — will download and generate now.")

    result = await refresh_hardware_json(config_dir, cache_dir=cache_dir)
    if result:
        log.info("Hardware database ready: %s", result)
    else:
        log.warning(
            "Hardware database refresh failed. "
            "Falling back to bundled database (may not match installed 86Box version)."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("86Web backend starting…")
    _bootstrap_db()
    _reset_stale_vm_status()
    # Refresh hardware database in the background — does not block startup
    asyncio.create_task(_refresh_hardware_db())
    yield
    log.info("86Web backend shutting down.")


app = FastAPI(
    title="86Web API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])

app.include_router(auth.router)
app.include_router(vms.router)
app.include_router(users.router)
app.include_router(system.router)
app.include_router(media.router)
app.include_router(library.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.app_name}
