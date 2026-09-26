import asyncio
import websockets
import psutil
import socket
import json
import os

MACHINE_NAME = socket.gethostname()

# قراءة الرابط من الملف الخارجي
config_path = os.path.join(os.path.dirname(__file__), 'config.json')
with open(config_path, 'r') as f:
    config = json.load(f)

BASE_URL = config.get("CONTROL_ROOM_URL")
WS_URL = f"{BASE_URL}/ws/agent/{MACHINE_NAME}"


# المهمة الأولى: إرسال نبضات الموارد (Heartbeats)
async def send_heartbeat(websocket):
    while True:
        try:
            payload = {
                "CPU_Usage": int(psutil.cpu_percent(interval=1)),
                "RAM_Usage": int(psutil.virtual_memory().percent),
                "HDD_Usage": int(psutil.disk_usage('/').percent)
            }
            await websocket.send(json.dumps(payload))
            print(f"[{MACHINE_NAME}] Heartbeat Sent (CPU: {payload['CPU_Usage']}%)")
            await asyncio.sleep(5)
        except Exception as e:
            print(f"Heartbeat Error: {e}")
            break


# المهمة الثانية: الاستماع لأوامر التشغيل من الـ Control Room
async def listen_for_commands(websocket):
    while True:
        try:
            message = await websocket.recv()
            print("\n" + "=" * 50)
            print(f"🔥 COMMAND RECEIVED FROM CONTROL ROOM 🔥")
            print(f"Message: {message}")

            if message.startswith("RUN_BOT"):
                bot_name = message.split(":")[1]
                print(f">>> INITIATING PROCESS: {bot_name} <<<")
                # هنا في بيئة الإنتاج يتم استخدام مكتبة subprocess لتشغيل البوت الفعلي:
                # subprocess.Popen([r"C:\Program Files\Automation Anywhere\RunBot.bat", bot_name])
                print(f"[{bot_name}] is now running in the background...")

            print("=" * 50 + "\n")
        except Exception as e:
            print(f"Listener Error: {e}")
            break


# المهمة الرئيسية: دمج المهمتين وربط الاتصال
async def main():
    print(f"Starting Enterprise Agent on {MACHINE_NAME}...")
    print(f"Connecting to Control Room via WebSockets -> {WS_URL}")

    while True:
        try:
            async with websockets.connect(WS_URL) as websocket:
                print("✅ Connected to Control Room Successfully!")

                # تشغيل الإرسال والاستقبال في نفس الوقت
                task1 = asyncio.create_task(send_heartbeat(websocket))
                task2 = asyncio.create_task(listen_for_commands(websocket))

                # انتظار المهمتين (سيعملان للأبد ما لم ينقطع الاتصال)
                await asyncio.gather(task1, task2)

        except (websockets.exceptions.ConnectionClosedError, ConnectionRefusedError):
            print("⚠️ Control Room unreachable. Retrying in 5 seconds...")
            await asyncio.sleep(5)


if __name__ == "__main__":
    # تشغيل الحلقة المتزامنة (Event Loop)
    asyncio.run(main())