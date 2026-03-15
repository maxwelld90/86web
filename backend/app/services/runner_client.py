import httpx
from fastapi import HTTPException
from ..config import get_settings

settings = get_settings()


def _forward_error(r: httpx.Response) -> None:
    """Raise an HTTPException with the runner's error detail."""
    try:
        detail = r.json().get("detail", f"Runner error {r.status_code}")
    except Exception:
        detail = f"Runner error {r.status_code}"
    raise HTTPException(status_code=r.status_code, detail=detail)


class RunnerClient:
    def __init__(self):
        self.base_url = settings.runner_url
        self.timeout = 30.0

    async def start_vm(self, vm_id: int, vm_dir: str, network_group_id: int | None = None) -> dict:
        payload: dict = {"vm_dir": vm_dir}
        if network_group_id is not None:
            payload["network_group_id"] = network_group_id
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/vms/{vm_id}/start", json=payload)
            if not r.is_success:
                _forward_error(r)
            return r.json()

    async def stop_vm(self, vm_id: int) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/vms/{vm_id}/stop")
            r.raise_for_status()
            return r.json()

    async def reset_vm(self, vm_id: int) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/vms/{vm_id}/reset")
            r.raise_for_status()
            return r.json()

    async def send_key(self, vm_id: int, key: str) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/vms/{vm_id}/send-key", json={"key": key})
            if not r.is_success:
                _forward_error(r)
            return r.json()

    async def pause_vm(self, vm_id: int) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/vms/{vm_id}/pause")
            r.raise_for_status()
            return r.json()

    async def get_vm_status(self, vm_id: int) -> dict:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                r = await client.get(f"{self.base_url}/vms/{vm_id}/status")
                r.raise_for_status()
                return r.json()
            except Exception:
                return {"status": "stopped"}

    async def get_version_info(self) -> dict:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"{self.base_url}/version")
            r.raise_for_status()
            return r.json()

    async def trigger_update(self) -> dict:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(f"{self.base_url}/update")
            r.raise_for_status()
            return r.json()

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.request(method, f"{self.base_url}{path}", **kwargs)
            r.raise_for_status()
            return r.json()
