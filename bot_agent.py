import asyncio
import websockets
import psutil
import socket
import json
import os
import platform
import logging
import random
import urllib.request
import urllib.error
from datetime import datetime
from urllib.parse import urlparse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler("agent.log"), logging.StreamHandler()],
)
logger = logging.getLogger("BotAgent")

AGENT_VERSION = "2.1.1"

MACHINE_NAME = socket.gethostname()
BASE_DIR = os.path.dirname(__file__)

CREDENTIALS_PATH = os.path.join(BASE_DIR, "agent_credentials.json")
ENROLL_CONFIG_PATH = os.path.join(BASE_DIR, "enroll_config.json")


def get_system_drive() -> str:
    if platform.system() == "Windows":
        return os.environ.get("SystemDrive", "C:") + "\\"
    return "/"


SYSTEM_DRIVE = get_system_drive()


def _extract_host_from_ws_url(ws_url: str) -> str | None:
    try:
        u = urlparse(ws_url)
        return u.hostname
    except Exception:
        return None


def get_local_ipv4(prefer_dst_host: str | None = None) -> str:
    """
    يحاول يجيب أفضل IPv4 حقيقي (مش 127.0.0.1).
    - الأفضل: IP اللي الجهاز هيستخدمه للوصول لسيرفر الـ Control Room
    - fallback: gethostbyname_ex
    """
    # 1) UDP trick (best)
    try:
        host = prefer_dst_host or "8.8.8.8"
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # مفيش ترافيك حقيقي، بس بيحدد الـ interface
        s.connect((host, 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass

    # 2) fallback
    try:
        ips = socket.gethostbyname_ex(socket.gethostname())[2]
        for ip in ips:
            if ip and not ip.startswith("127."):
                return ip
    except Exception:
        pass

    return "0.0.0.0"


def load_credentials() -> dict | None:
    """يحاول تحميل بيانات اعتماد دائمة محفوظة محلياً من تشغيل سابق"""
    if os.path.exists(CREDENTIALS_PATH):
        with open(CREDENTIALS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def save_credentials(control_room_url: str, agent_token: str, allowed_bots: list, heartbeat_interval_seconds: int):
    with open(CREDENTIALS_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {
                "CONTROL_ROOM_URL": control_room_url,
                "AGENT_TOKEN": agent_token,
                "ALLOWED_BOTS": allowed_bots,
                "HEARTBEAT_INTERVAL_SECONDS": heartbeat_interval_seconds,
            },
            f,
            indent=2,
        )
    logger.info("تم حفظ بيانات الاعتماد الدائمة محلياً بنجاح")


def enroll_with_server() -> dict:
    """
    ✅ التفعيل الذاتي - يُستخدم مرة واحدة فقط عند أول تشغيل.
    يقرأ كود الإقران من enroll_config.json ويبادله بتوكن دائم.
    """
    if not os.path.exists(ENROLL_CONFIG_PATH):
        logger.critical(
            f"لا يوجد بيانات اعتماد محفوظة ({CREDENTIALS_PATH}) ولا ملف إقران ({ENROLL_CONFIG_PATH}). "
            "يجب تسجيل هذا الجهاز أولاً من لوحة التحكم والحصول على enroll_config.json"
        )
        raise SystemExit(1)

    with open(ENROLL_CONFIG_PATH, "r", encoding="utf-8") as f:
        enroll_data = json.load(f)

    control_room_ws_url = enroll_data["CONTROL_ROOM_URL"]
    enrollment_code = enroll_data["ENROLLMENT_CODE"]

    # تحويل ws:// إلى http:// للتفعيل
    control_room_http_url = (
        control_room_ws_url.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")
    )

    logger.info(f"محاولة تفعيل الجهاز باستخدام كود الإقران: {enrollment_code}")

    payload = json.dumps(
        {
            "MachineName": MACHINE_NAME,
            "EnrollmentCode": enrollment_code,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{control_room_http_url}/api/agent/enroll",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        logger.critical(f"فشل التفعيل ({e.code}): {error_body}")
        raise SystemExit(1)
    except Exception as e:
        logger.critical(f"فشل الاتصال بالسيرفر للتفعيل: {e}")
        raise SystemExit(1)

    agent_token = result["agent_token"]
    allowed_bots = enroll_data.get("ALLOWED_BOTS", [])
    heartbeat_interval = int(enroll_data.get("HEARTBEAT_INTERVAL_SECONDS", 5))

    save_credentials(control_room_ws_url, agent_token, allowed_bots, heartbeat_interval)

    # حذف ملف الإقران بعد الاستخدام
    try:
        os.remove(ENROLL_CONFIG_PATH)
    except Exception:
        pass

    logger.info("✅ تم تفعيل الجهاز بنجاح! تم حذف ملف الإقران المؤقت.")

    return {
        "CONTROL_ROOM_URL": control_room_ws_url,
        "AGENT_TOKEN": agent_token,
        "ALLOWED_BOTS": allowed_bots,
        "HEARTBEAT_INTERVAL_SECONDS": heartbeat_interval,
    }


# ============================================================
# تحميل بيانات الاعتماد: إما محفوظة مسبقاً، أو تفعيل ذاتي أول مرة
# ============================================================
credentials = load_credentials()
if credentials is None:
    logger.info("لا توجد بيانات اعتماد محفوظة - بدء عملية التفعيل الذاتي (Self-Enrollment)...")
    credentials = enroll_with_server()

BASE_URL = str(credentials["CONTROL_ROOM_URL"]).rstrip("/")
AGENT_TOKEN = credentials["AGENT_TOKEN"]
ALLOWED_BOTS = set(credentials.get("ALLOWED_BOTS", []))
HEARTBEAT_INTERVAL = int(credentials.get("HEARTBEAT_INTERVAL_SECONDS", 5))

WS_URL = f"{BASE_URL}/ws/agent/{MACHINE_NAME}?token={AGENT_TOKEN}"
PREFERRED_DST_HOST = _extract_host_from_ws_url(BASE_URL)


async def send_heartbeat(websocket):
    # prime cpu meter (علشان أول قراءة ما تبقاش 0 أو مش دقيقة)
    try:
        psutil.cpu_percent(interval=None)
    except Exception:
        pass

    while True:
        try:
            payload = {
                "MachineName": MACHINE_NAME,
                "MachineIP": get_local_ipv4(PREFERRED_DST_HOST),
                "OSName": platform.system(),
                "AgentVersion": AGENT_VERSION,

                "CPU_Usage": int(psutil.cpu_percent(interval=0.2)),
                "RAM_Usage": int(psutil.virtual_memory().percent),
                "HDD_Usage": int(psutil.disk_usage(SYSTEM_DRIVE).percent),
                "Timestamp": datetime.utcnow().isoformat(),
            }

            await websocket.send(json.dumps(payload, ensure_ascii=False))
            logger.info(f"Heartbeat Sent (IP: {payload['MachineIP']}, CPU: {payload['CPU_Usage']}%, HDD: {payload['HDD_Usage']}%)")

            await asyncio.sleep(HEARTBEAT_INTERVAL)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"Heartbeat failed: {e}")
            await asyncio.sleep(HEARTBEAT_INTERVAL)


async def listen_for_commands(websocket):
    while True:
        try:
            message = await websocket.recv()
            logger.info(f"COMMAND RECEIVED: {message}")

            if message.startswith("RUN_BOT:"):
                bot_name = message.split(":", 1)[1].strip()

                if ALLOWED_BOTS and bot_name not in ALLOWED_BOTS:
                    logger.warning(f"Rejected unauthorized execution request: {bot_name}")
                    continue

                logger.info(f">>> INITIATING PROCESS: {bot_name} <<<")
                # subprocess.Popen([...], shell=False)  # في الإنتاج

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"Command listener error: {e}")
            await asyncio.sleep(1)


async def run_agent_session():
    async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=20) as websocket:
        logger.info("✅ Connected to Control Room Successfully!")

        tasks = [
            asyncio.create_task(send_heartbeat(websocket)),
            asyncio.create_task(listen_for_commands(websocket)),
        ]

        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)

        for t in pending:
            t.cancel()

        for t in done:
            if t.exception():
                raise t.exception()


async def main():
    logger.info(f"Starting Enterprise Agent v{AGENT_VERSION} on {MACHINE_NAME}...")
    retry_delay, max_delay = 5, 60

    while True:
        try:
            await run_agent_session()
            retry_delay = 5
        except websockets.exceptions.ConnectionClosedError as e:
            if e.code == 1008:
                logger.critical(
                    "❌ السيرفر رفض التوكن الدائم (ربما تم حذف الجهاز أو تم تغيير AgentToken). "
                    f"احذف ملف {CREDENTIALS_PATH} وأعد التفعيل من جديد."
                )
                raise SystemExit(1)

            logger.warning(f"⚠️ Disconnected ({e}). Retrying in {retry_delay}s...")

        except Exception as e:
            logger.warning(f"⚠️ Disconnected ({e}). Retrying in {retry_delay}s...")

        await asyncio.sleep(retry_delay + random.uniform(0, 2))
        retry_delay = min(retry_delay * 2, max_delay)


if __name__ == "__main__":
    asyncio.run(main())