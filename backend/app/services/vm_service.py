"""VM lifecycle management — thin wrapper around the runner client."""
from .runner_client import RunnerClient


class VMService:
    def __init__(self):
        self.client = RunnerClient()

    async def start_vm(self, vm_id: int, vm_dir: str, network_group_id: int | None = None) -> dict:
        return await self.client.start_vm(vm_id, vm_dir, network_group_id=network_group_id)

    async def stop_vm(self, vm_id: int) -> dict:
        return await self.client.stop_vm(vm_id)

    async def reset_vm(self, vm_id: int) -> dict:
        return await self.client.reset_vm(vm_id)

    async def pause_vm(self, vm_id: int) -> dict:
        return await self.client.pause_vm(vm_id)

    async def send_key(self, vm_id: int, key: str) -> dict:
        return await self.client.send_key(vm_id, key)

    async def get_vm_status(self, vm_id: int) -> dict:
        return await self.client.get_vm_status(vm_id)
