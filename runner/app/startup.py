#!/usr/bin/env python3
"""Called by entrypoint.sh before the main app starts."""
import asyncio
import logging
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    stream=sys.stdout,
)

from app.updater import startup_update_check

if __name__ == "__main__":
    asyncio.run(startup_update_check())
