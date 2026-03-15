from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class RunnerSettings(BaseSettings):
    box86_version: str = ""
    box86_arch: str = "x86_64"
    base_vnc_port: int = 5900
    max_concurrent_vms: int = 50
    active_vm_limit: int = 5   # hard cap on simultaneously running VMs
    log_level: str = "info"
    vm_auto_shutdown_minutes: int = 0  # 0 = disabled; stop VMs running longer than this

    data_path: str = "/data"
    box86_bin: str = "/data/cache/86box/86Box"
    box86_dir: str = "/data/cache/86box"

    @property
    def box86_exec(self) -> str:
        return self.box86_bin

    @property
    def roms_path(self) -> str:
        return os.path.join(self.data_path, "roms")

    @property
    def cache_path(self) -> str:
        return os.path.join(self.data_path, "cache", "86box")

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> RunnerSettings:
    return RunnerSettings()
