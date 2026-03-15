from pydantic_settings import BaseSettings
from functools import lru_cache
import os
import secrets as _secrets

# Generated once per process — tokens become invalid after a restart when no
# APP_SECRET_KEY env-var is configured. Set APP_SECRET_KEY in the environment
# for tokens that survive restarts (e.g. long-running production deployments).
_RUNTIME_SECRET = _secrets.token_hex(32)


class Settings(BaseSettings):
    app_name: str = "86Web"
    app_secret_key: str = _RUNTIME_SECRET
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    # Auth
    user_management: bool = True
    admin_username: str = "admin"
    admin_password: str = "changeme"
    admin_email: str = "admin@example.com"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440

    # LDAP
    ldap_enabled: bool = False
    ldap_server: str = ""
    ldap_port: int = 389
    ldap_base_dn: str = ""
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""
    ldap_user_filter: str = "(objectClass=person)"
    ldap_group_dn: str = ""
    ldap_username_attr: str = "uid"
    ldap_email_attr: str = "mail"
    ldap_tls: bool = False

    # Runner
    runner_url: str = "http://runner:8001"

    # Quotas
    default_max_vms: int = 10
    default_max_storage_gb: int = 100

    # Logging
    log_level: str = "info"

    # Data paths (inside container)
    data_path: str = "/data"

    @property
    def db_path(self) -> str:
        return os.path.join(self.data_path, "config", "86web.db")

    @property
    def vms_path(self) -> str:
        return os.path.join(self.data_path, "vms")

    @property
    def roms_path(self) -> str:
        return os.path.join(self.data_path, "roms")

    @property
    def cache_path(self) -> str:
        return os.path.join(self.data_path, "cache")

    # External read-only image library (mounted at /library in production)
    library_path: str = "/library"

    def user_images_path(self, user_id: int) -> str:
        """Return the per-user (or shared) images directory path."""
        if self.user_management:
            return os.path.join(self.data_path, "user_images", str(user_id))
        return os.path.join(self.data_path, "user_images")

    def shared_media_path(self, user_id: int) -> str:
        """Return the per-user (or shared) media pool directory path."""
        if self.user_management:
            return os.path.join(self.data_path, "shared_media", str(user_id))
        return os.path.join(self.data_path, "shared_media")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
