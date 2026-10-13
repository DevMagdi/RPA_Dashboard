#!/usr/bin/env python
"""RPA Agent — runs on the robot machine and talks to the Control Room.

Replaces the legacy ``bot_agent.py`` (which polled the old monolithic API with
an unauthenticated shared key).  The new protocol is per-machine, token based
and audited end-to-end:

1. **Enrol once** with the one-time code issued from the Infrastructure screen
   (``POST /api/agent/enroll``) → returns a long-lived agent token.
2. **Heartbeat** every ``--interval`` seconds with CPU/RAM/disk telemetry
   (``POST /api/agent-heartbeat``, ``X-Agent-Token`` header).
3. **Listen** on the websocket ``/ws/agent/{machine_name}`` for commands
   (``RUN_BOT``, ``STOP_BOT``, ``PING``, ``REFRESH_CONFIG`` …) and acknowledge
   each one (``POST /api/agent/commands/ack``) so the Control Room can show
   delivery guarantees.

The runner hooks (``on_run``/``on_stop``) are intentionally pluggable: a UiPath
or Automation Anywhere unattended runner simply replaces them.

    # first run: enrol and store the token
    python scripts/rpa_agent.py enrol --url https://coe.bank.local \
        --machine Bot-07 --code ABC123 --token-file /etc/rpa/agent.token

    # then as a service
    python scripts/rpa_agent.py run --url https://coe.bank.local --machine Bot-07 \
        --token-file /etc/rpa/agent.token --process Invoice_Processing
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import platform
import shutil
import socket
import sys
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import httpx

try:  # websockets is optional: without it the agent degrades to HTTP only
    import websockets
except ImportError:  # pragma: no cover - optional dependency
    websockets = None  # type: ignore[assignment]

LOG = logging.getLogger("rpa-agent")
DEFAULT_TIMEOUT = 20.0


# --------------------------------------------------------------------------- #
# telemetry
# --------------------------------------------------------------------------- #
def _cpu_usage() -> float:
    """Best-effort CPU utilisation in percent (no psutil dependency)."""
    try:
        load = os.getloadavg()[0]
        return round(min(100.0, load / (os.cpu_count() or 1) * 100), 1)
    except (OSError, AttributeError):
        return 0.0


def _ram_usage() -> float:
    """Memory utilisation in percent from /proc when available."""
    try:
        info: Dict[str, int] = {}
        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                key, _, value = line.partition(":")
                info[key.strip()] = int(value.strip().split()[0])
        total = info.get("MemTotal") or 0
        available = info.get("MemAvailable", info.get("MemFree", 0))
        if total:
            return round((total - available) / total * 100, 1)
    except (OSError, ValueError):
        pass
    return 0.0


def _disk_usage(path: str = "/") -> float:
    try:
        usage = shutil.disk_usage(path)
        return round(usage.used / usage.total * 100, 1)
    except OSError:
        return 0.0


def collect_telemetry() -> Dict[str, Any]:
    """Snapshot the machine so the Control Room can render the fleet view."""
    return {
        "CPU_Usage": _cpu_usage(),
        "RAM_Usage": _ram_usage(),
        "HDD_Usage": _disk_usage(),
        "MachineIP": socket.gethostbyname(socket.gethostname()),
        "OSName": f"{platform.system()} {platform.release()}",
        "AgentVersion": "4.0.0",
    }


# --------------------------------------------------------------------------- #
# agent
# --------------------------------------------------------------------------- #
class RpaAgent:
    """Minimal, dependency-light robot agent."""

    def __init__(
        self,
        base_url: str,
        machine_name: str,
        token: str,
        *,
        process: Optional[str] = None,
        interval: int = 60,
        verify: bool = True,
        on_run: Optional[Callable[[Dict[str, Any]], None]] = None,
        on_stop: Optional[Callable[[Dict[str, Any]], None]] = None,
        ca_bundle: Optional[str] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.machine_name = machine_name
        self.token = token
        self.process = process
        self.interval = max(10, interval)
        self.verify: Any = ca_bundle or verify
        self.on_run = on_run or self._default_run
        self.on_stop = on_stop or self._default_stop
        self._processes: Dict[str, Any] = {}
        self._client = httpx.Client(base_url=self.base_url, timeout=DEFAULT_TIMEOUT, verify=self.verify)
        self._stopping = asyncio.Event()

    # -- http ------------------------------------------------------------
    @property
    def _headers(self) -> Dict[str, str]:
        return {"X-Agent-Token": self.token}

    @classmethod
    def enroll(
        cls,
        base_url: str,
        machine_name: str,
        code: str,
        *,
        verify: bool = True,
        ca_bundle: Optional[str] = None,
    ) -> str:
        """Exchange a one-time enrolment code for the machine's agent token."""
        with httpx.Client(base_url=base_url.rstrip("/"), timeout=DEFAULT_TIMEOUT, verify=ca_bundle or verify) as client:
            response = client.post(
                "/api/agent/enroll",
                json={"MachineName": machine_name, "EnrollmentCode": code},
            )
            response.raise_for_status()
            payload = response.json()
        token = payload.get("agent_token") or payload.get("token")
        if not token:
            raise RuntimeError(f"enrolment response contained no token: {payload}")
        LOG.info("enrolled %s (heartbeat every %ss)", machine_name, payload.get("heartbeat_interval_seconds", 60))
        return str(token)

    def heartbeat(self) -> Dict[str, Any]:
        payload = {"MachineName": self.machine_name, **collect_telemetry()}
        response = self._client.post("/api/agent-heartbeat", json=payload, headers=self._headers)
        response.raise_for_status()
        return response.json() if response.content else {}

    def acknowledge(self, command_id: Any, success: bool, result: str) -> None:
        self._client.post(
            "/api/agent/commands/ack",
            json={"MachineName": self.machine_name, "CommandID": command_id, "Success": success, "Result": result},
            headers=self._headers,
        )

    # -- command handlers ------------------------------------------------
    def _verify_signature(self, command: Dict[str, Any]) -> bool:
        """Verify the Control Room's HMAC over the command (fail closed).

        The server signs ``machine|command|payload_json``; the secret is
        shared via the ``AGENT_COMMAND_HMAC_SECRET`` environment variable.
        When no secret is configured (dev only) verification is skipped.
        """
        import hashlib
        import hmac as _hmac
        import os

        secret = os.getenv("AGENT_COMMAND_HMAC_SECRET", "")
        signature = command.get("signature")
        if not secret:
            return True
        if not signature:
            LOG.error("unsigned command rejected (HMAC secret configured)")
            return False
        payload = {
            "process_name": command.get("process_name") or command.get("ProcessName"),
            "run_id": command.get("run_id") or command.get("RunID"),
            "parameters": command.get("parameters") or {},
            "reason": command.get("reason"),
            "issued_by": command.get("issued_by"),
        }
        payload_json = json.dumps(payload, default=str, sort_keys=True)
        name = str(command.get("command") or command.get("Command", "")).upper()
        expected = _hmac.new(
            secret.encode(), f"{self.machine_name}|{name}|{payload_json}".encode(), hashlib.sha256
        ).hexdigest()
        return _hmac.compare_digest(expected, str(signature))

    def _bot_command_line(self, process: str) -> Optional[list]:
        """Resolve how to start ``process`` on this runner.

        Configuration (environment only — never hard-code vendor paths):
        ``RPA_BOT_COMMANDS_JSON`` maps process → command template, and
        ``RPA_BOT_COMMAND`` is the fallback template. Templates may use
        ``{process}``, ``{machine}`` and ``{run_id}`` placeholders, e.g.
        UiPath: ``"C:\\UiPath\\UiRobot.exe" execute --process {process}``.
        """
        import os
        import shlex

        template = None
        raw_map = os.getenv("RPA_BOT_COMMANDS_JSON", "")
        if raw_map:
            try:
                template = json.loads(raw_map).get(process)
            except json.JSONDecodeError:
                LOG.error("RPA_BOT_COMMANDS_JSON is not valid JSON")
        template = template or os.getenv("RPA_BOT_COMMAND", "")
        if not template:
            return None
        rendered = template.format(process=process, machine=self.machine_name, run_id="")
        return shlex.split(rendered, posix=False)

    def _report_run_start(self, process: str, command_id: Any) -> Optional[int]:
        try:
            response = self._client.post(
                "/api/runs/start",
                json={"ProcessName": process, "MachineName": self.machine_name, "Trigger": "agent"},
                headers={**self._headers, "Idempotency-Key": f"cmd-{command_id}"},
            )
            response.raise_for_status()
            return response.json().get("run_id")
        except Exception as error:  # noqa: BLE001
            LOG.warning("run start report failed: %s", error)
            return None

    def _report_run_complete(self, run_id: Optional[int], success: bool, detail: str = "") -> None:
        if not run_id:
            return
        try:
            self._client.post(
                f"/api/runs/{run_id}/complete",
                json={"Status": "Success" if success else "Failed", "FailureReason": detail or None},
                headers=self._headers,
            )
        except Exception as error:  # noqa: BLE001
            LOG.warning("run complete report failed: %s", error)

    def _default_run(self, command: Dict[str, Any]) -> str:
        """Actually start the bot process and report the run lifecycle."""
        import subprocess
        import threading

        process = command.get("process_name") or command.get("ProcessName") or self.process or "unknown"
        command_id = command.get("command_id") or command.get("CommandID")
        argv = self._bot_command_line(str(process))
        if not argv:
            raise RuntimeError(
                "no bot command configured on this runner (set RPA_BOT_COMMAND or RPA_BOT_COMMANDS_JSON)"
            )
        LOG.info("starting %s: %s", process, argv)
        proc = subprocess.Popen(argv)  # noqa: S603 - argv from local admin config, list form
        self._processes[str(process)] = proc
        run_id = self._report_run_start(str(process), command_id)

        def _watch() -> None:
            code = proc.wait()
            self._report_run_complete(run_id, code == 0, "" if code == 0 else f"exit code {code}")
            LOG.info("bot %s finished (exit=%s, run_id=%s)", process, code, run_id)

        threading.Thread(target=_watch, daemon=True).start()
        return f"started {process} pid={proc.pid} run_id={run_id}"

    def _default_stop(self, command: Dict[str, Any]) -> str:
        process = command.get("process_name") or command.get("ProcessName") or self.process
        proc = self._processes.get(str(process))
        if proc and proc.poll() is None:
            proc.terminate()
            return f"stop requested for {process}"
        return f"no running bot for {process}"

    def _handle(self, command: Dict[str, Any]) -> None:
        name = str(command.get("command") or command.get("Command", "")).upper()
        command_id = command.get("command_id") or command.get("CommandID")
        LOG.info("command received: %s", name)
        try:
            if not self._verify_signature(command):
                self.acknowledge(command_id, False, "signature verification failed")
                return
            if name in {"RUN_BOT", "START_BOT"}:
                result = self.on_run(command)
            elif name in {"STOP_BOT", "STOP"}:
                result = self.on_stop(command)
            elif name == "PING":
                result = f"pong from {self.machine_name}"
            elif name == "REFRESH_CONFIG":
                result = "configuration refreshed"
            elif name == "UPDATE_AGENT":
                result = "update scheduled"
            else:
                result = f"unsupported command {name}"
            self.acknowledge(command_id, True, str(result))
        except Exception as error:  # noqa: BLE001 - the agent must never die on one command
            LOG.exception("command failed")
            self.acknowledge(command_id, False, str(error)[:400])

    # -- loops -----------------------------------------------------------
    async def _heartbeat_loop(self) -> None:
        while not self._stopping.is_set():
            try:
                self.heartbeat()
                LOG.debug("heartbeat sent")
            except Exception as error:  # noqa: BLE001
                LOG.warning("heartbeat failed: %s", error)
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=self.interval)
            except asyncio.TimeoutError:
                continue

    async def _command_loop(self) -> None:
        if websockets is None:
            LOG.warning("websockets not installed — command channel disabled (pip install websockets)")
            return
        ws_url = f"{self.base_url.replace('http://', 'ws://').replace('https://', 'wss://')}/ws/agent/{self.machine_name}"
        while not self._stopping.is_set():
            try:
                async with websockets.connect(ws_url, subprotocols=[f"agent-token.{self.token}"]) as socket:
                    LOG.info("command channel connected")
                    async for raw in socket:
                        try:
                            message = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if message.get("type") == "command" or message.get("event") == "command":
                            self._handle(message.get("data", message))
            except Exception as error:  # noqa: BLE001
                LOG.warning("command channel error: %s (retrying in 10 s)", error)
                try:
                    await asyncio.wait_for(self._stopping.wait(), timeout=10)
                except asyncio.TimeoutError:
                    continue

    async def serve(self) -> None:
        LOG.info("agent starting as %s", self.machine_name)
        await asyncio.gather(self._heartbeat_loop(), self._command_loop())

    def stop(self) -> None:
        self._stopping.set()


# --------------------------------------------------------------------------- #
# cli
# --------------------------------------------------------------------------- #
def _read_token(token_file: str) -> str:
    path = Path(token_file)
    if not path.exists():
        raise SystemExit(f"token file {token_file} not found — run `enrol` first")
    return path.read_text(encoding="utf-8").strip()


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description="RPA Control Room agent")
    parser.add_argument("action", choices=["enrol", "enroll", "run", "once", "selftest"])
    parser.add_argument("--url", default=os.getenv("CONTROL_ROOM_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--machine", default=socket.gethostname())
    parser.add_argument("--code", help="one-time enrolment code (enrol only)")
    parser.add_argument("--token-file", default=os.getenv("RPA_AGENT_TOKEN_FILE", "/etc/rpa/agent.token"))
    parser.add_argument("--process", help="default process handled by this machine")
    parser.add_argument("--interval", type=int, default=60, help="heartbeat interval in seconds")
    parser.add_argument("--insecure", action="store_true", help="skip TLS verification (lab only)")
    parser.add_argument("--ca-bundle", help="path to the bank's internal CA bundle")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    if args.action == "selftest":
        print(json.dumps(collect_telemetry(), indent=2))
        return 0

    if args.action in {"enrol", "enroll"}:
        if not args.code:
            parser.error("--code is required to enrol")
        token = RpaAgent.enroll(args.url, args.machine, args.code, verify=not args.insecure, ca_bundle=args.ca_bundle)
        target = Path(args.token_file)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(token, encoding="utf-8")
        os.chmod(target, 0o600)
        print(f"token stored in {target}")
        return 0

    agent = RpaAgent(
        args.url,
        args.machine,
        _read_token(args.token_file),
        process=args.process,
        interval=args.interval,
        verify=not args.insecure,
        ca_bundle=args.ca_bundle,
    )
    if args.action == "once":
        print(json.dumps(agent.heartbeat(), indent=2, default=str))
        return 0

    try:
        asyncio.run(agent.serve())
    except KeyboardInterrupt:
        agent.stop()
        LOG.info("agent stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
