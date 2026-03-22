from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import get_settings
import os
import sqlite3

settings = get_settings()

os.makedirs(os.path.dirname(settings.db_path), exist_ok=True)

# --- NEU: Auto-Migration ---
def apply_migrations(db_path: str):
    """Checking existing DB and adding missing columns / tables."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # 1. Check if users table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        if cursor.fetchone():
            # Read users column tables
            cursor.execute("PRAGMA table_info(users)")
            columns = [info[1] for info in cursor.fetchall()]
            
            # Add missing permission columns (1 = True in SQLite)
            if "can_manage_vms" not in columns:
                cursor.execute("ALTER TABLE users ADD COLUMN can_manage_vms BOOLEAN NOT NULL DEFAULT 1")
                cursor.execute("ALTER TABLE users ADD COLUMN can_manage_groups BOOLEAN NOT NULL DEFAULT 1")
                cursor.execute("ALTER TABLE users ADD COLUMN can_access_library BOOLEAN NOT NULL DEFAULT 1")
                cursor.execute("ALTER TABLE users ADD COLUMN can_upload_images BOOLEAN NOT NULL DEFAULT 1")
                print("Migration: Added new Permission Columns to 'users'.")

        # 2. Check if vms table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='vms'")
        if cursor.fetchone():
            cursor.execute("PRAGMA table_info(vms)")
            columns = [info[1] for info in cursor.fetchall()]
            
            # Add missing locked_by column
            if "locked_by_user_id" not in columns:
                cursor.execute("ALTER TABLE vms ADD COLUMN locked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
                print("Migration: Column 'locked_by_user_id' was added to 'vms'.")
                
        conn.commit()
    except Exception as e:
        print(f"Error during Database-Migration: {e}")
    finally:
        conn.close()

# Migration Part
apply_migrations(settings.db_path)
# ------------------------------------

engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()