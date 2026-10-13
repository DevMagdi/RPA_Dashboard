# مراجعة كود مشروع RPA_Dashboard (CoE Control Room)

> **تاريخ المراجعة:** 2026-10-13 · **الفرع:** `arena/f39c9e29-rpa-dashboard` · **آخر كوميت مراجع:** `6fc5308 updated version`
> **نوع المراجعة:** Static review (كود + هيكل + إعدادات). لم أشغّل الـ backend فعلياً لأن البيئة مفيش فيها SQL Server/Redis — لكن نفّذت `py_compile` على كل ملفات البايثون (**سليم**) و`npm run build` للواجهة (**نجح** بدون أخطاء).

---

## 1) نظرة عامة

المشروع **منصة تحكم مركزية (Control Room) لعمليات RPA**، بيتكوّن من 3 طبقات:

| الطبقة | التقنية | الملفات | الحجم |
|---|---|---|---|
| الـ API / Control Room | FastAPI + SQLAlchemy + pyodbc + Redis + slowapi | `api.py` (1597 سطر)، `routers/auth.py`، `db_connection.py` | ~2030 سطر |
| الـ Agent (على أجهزة التشغيل) | websockets + psutil + urllib | `bot_agent.py` | 291 سطر |
| الواجهة (React 19 + Vite 8 + Tailwind + Recharts) | SPA | `rpa-dashboard/src/**` | ~3350 سطر |
| قاعدة البيانات | SQL Server (سكربتات يدوية) | `rpa_dashboard.sql` | 173 سطر |

**الوظائف الحالية:** تسجيل دخول + RBAC + ديب من التقسيمات، مؤشرات أداء (KPI)، ROI Configuration، SLA & Workload، سجل تدقيق (Audit Log)، دورة حياة نسخ البوت (Dev→UAT→Prod) + خزنة أسرار مشفّرة (Fernet)، إدارة البنية التحتية وأجهزة التشغيل، وتفعيل ذاتي للـ Agents (Enrollment Code → دائم Token).

### تقييمي المختصر

| الجانب | التقييم | تعليق |
|---|---|---|
| الفكرة وتغطية الوظائف | 🟢 8/10 | Scope واضح وطموح ومناسب جداً لبنك/شركة كبيرة |
| الأمان | 🔴 4.5/10 | الأساس كويس لكن فيه 3 ثغرات قاتلة (أسرار في git، مفتاح تشفير مؤقت، Host allowlist) |
| جودة الكود والقراءة | 🟡 6/10 | الباك إند منظم، الفرونت مونوليث 2090 سطر في ملف واحد |
| الأداء وقابلية التوسع | 🟡 5/10 | 9 استعلامات لكل طلب داشبورد + polling جاهل + مفيش فهارس ولا caching |
| الجاهزية للإنتاج (Ops/CI/Tests) | 🔴 3/10 | صفر اختبارات، صفر CI، مفيش Dockerfile، الهجرات (migrations) سكربتات متفرقة |

**الخلاصة في جملة:** ده **نموذج عمل قوي جداً (POC/Demo ممتاز)** بفكر هندسي سليم في أغلب الأماكن — لكنه **لسه مش جاهز للإنتاج** قبل إغلاق بنود الأمان الحمراء وتشغيل مسارات إدخال البيانات.

---

## 2) نقاط القوة (تستاهل تتحافظ عليها)

1. **كل الاستعلامات Parameterized** (`text()` + `bindparam`) — مفيش SQL Injection ظاهر ولا حتى في الفلترة الديناميكية (الـ `f-string` مستخدم بس في أجزاء ثابتة أو أعداد صحيحة متحقق منها بـ Pydantic `le=`).
2. **`clean_json_data` + `raise_safe_error`**: طبقة تحويل آمنة للـ JSON (تتعامل مع `NaN`/`NaT`/`np.int64`) وطبقة موحّدة للأخطاء تُخفي تفاصيل الـ DB عن المستخدم.
3. **RBAC حقيقي على مستوى الداتا** — مش مجرد إخفاء أزرار: `AllowedDepartment` بيتفلتر في الـ SQL نفسه (`c.Department = :dept`)، و`process` غير المصرّح به بيرجّع 403.
4. **تصميم الـ Enrollment ممتاز**: كود لمرة واحدة + TTL + `IsUsed` + توكن دائم يُخزَّن **hashed** مع Pepper و`secrets.compare_digest` (تصميم صحّي جداً بدل تخزين التوكن كما هو).
5. **تشفير الأسرار بـ Fernet** بدل plaintext في الداتابيز + Endpoint فك التشفير مقصور على `SuperAdmin`.
6. **Audit Logging شامل** على كل الإجراءات الحسّاسة (ROI/SLA/النسخ/الترقية/الخزنة/الدخول) مع Old/New values و IP.
7. **حماية إضافية موجودة**: Security Headers، GZip، Rate Limiting على الدخول والـ Enrollment، قفل الحساب بعد محاولات فاشلة، ورسائل دخول غير كاشفة (generic).
8. **تفكير أداء في الفرونت**: Keyset Pagination (`after`) + Virtualization يدوي (`VirtualTreeList`) + Debounce للبحث + Request-ID guards لمنع race conditions بين الطلبات.
9. **الـ Agent module مهني**: retry بـ exponential backoff + jitter، إشارة واضحة لكود 1008 (توكن مرفوض)، وتحديد الـ IPv4 الحقيقي بـ UDP trick.
10. **واجهة استخدام جميلة** ومتناسقة بصرياً (هوية لونية موحّدة) و`npm run build` يننجح نظيف.

---

## 3) المشاكل الحرجة (P0) — لازم تتصلّح قبل أي نشر

### 🔴 P0-1: مفتاح التشفير بيتولّد عشوائياً كل restart ⇒ **ضياع كل أسرار الخزنة**
`api.py:61-80`

```python
_FERNET_KEY = os.environ.get("FERNET_KEY")
if not _FERNET_KEY:
    logger.warning("FERNET_KEY not found. Generating TEMP key for DEV.")
    _FERNET_KEY = Fernet.generate_key().decode()
```

`FERNET_KEY` **غير موجود في `.env`** ⇒ كل تشغيل للسيرفر بيعمل مفتاح جديد ⇒ **كل قيمة في `BotVault` بتصبح غير قابلة للفك** (`decrypt` هيرمي استثناء)، والEndpoint بيرجّع 500. ده معناها إن كل الأسرار المخزنة عمالة تضيع بصمت.

**الإصلاح:**
```python
_FERNET_KEY = os.environ.get("FERNET_KEY")
if not _FERNET_KEY:
    if ENV == "prod":
        raise RuntimeError("FERNET_KEY is required in production")   # فشل إقلاع صريح
    logger.warning("DEV MODE: using ephemeral key — vault data will be LOST on restart")
```
\+ إضافة `FERNET_KEY` ثابت في `.env` (توليده: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`)، \+ خطة **key rotation** (تخزين `key_id` مع كل سر، أو أعمد بـ `MultiFernet`).

---

### 🔴 P0-2: أسرار حقيقية مرفوعة على Git
- `.env` **متتبَّع في git** وفيه: `DB_PASSWORD`, `JWT_SECRET_KEY`, `AGENT_TOKEN_PEPPER` (وقيم DB ضعيفة أصلاً: `123456`).
- `rpa_dashboard.sql:7` فيه `CREATE LOGIN rpa_user WITH PASSWORD = 'Rpa@123456'`.
- `rpa_dashboard.sql` + `RPA_Dashboard.bak` (11 ميجا) + `.idea/**` كلهم متتبَّعين.

الريبو **private** (قلّلت الخطورة)، لكن أي collaborator/نسخة محلية/نسخة من الـ history = تسريب كامل.

**الإصلاح (بالترتيب):**
1. ولّد أسرار جديدة ودوّرها فوراً: كلمة مرور `rpa_user`، `JWT_SECRET_KEY`، `AGENT_TOKEN_PEPPER` (تحذير: تغيير الـ pepper بيرجّع كل توكنات الأجهزة غير صالحة ⇒ محتاجة إعادة enrollment).
2. `git rm --cached .env` + إضافة `.env.example` بقيم placeholders.
3. تنظيف الـ history: `git filter-repo --path .env --invert-paths` (أو BFG) + force push **بعد التنسيق مع أي حد عنده clone**.
4. تشغيل Secret Scanner في CI (`gitleaks` / `trufflehog`) لمنع التكرار.

---

### 🔴 P0-3: مفيش `.gitignore` في جذر الريبو
`rpa-dashboard/.gitignore` بيغطي الفرونت فقط. النتيجة إن الملفات دي **قابلة للكوميت حالياً** وواحد منها كارثة:
- `agent_credentials.json` ← **التوكن الدائم للجهاز** (لو اتكومّت = أي حد يقدر ينتحل الجهاز)
- `api.log`, `agent.log`, `*.bak`, `.idea/`, `__pycache__/`, `dist/`

**الإصلاح:** `.gitignore` على الجذر:
```gitignore
# Secrets & agent state
.env
agent_credentials.json
enroll_config.json
*.pem
# Logs
*.log
# Python
__pycache__/
*.py[cod]
.venv/
venv/
# Local artifacts
*.bak
.idea/
.vscode/
```
\+ `git rm -r --cached .idea RPA_Dashboard.bak streamlit/` (ملف الباك أب ده مكانه ملفات الشركة/التخزين الخارجي مش الريبو — و11MB في git معناها نسخة ناقصة ومضاعفة الحجم دائماً).

---

### 🔴 P0-4: `TrustedHostMiddleware` مسموح له بـ localhost بس ⇒ **النشر الحقيقي هيفشل 100%**
`api.py:124`
```python
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "::1"])
```
أي وصول عن طريق IP السيرفر أو دومين أو Reverse Proxy (Nginx/IIS) → `400 Invalid host header`. وكمان مفيش `ForwardedHeaders`/`ProxyHeaders` middleware، فأي سجلات IP هتبقى IP البروكسي.

**الإصلاح:**
```python
ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=[h.strip() for h in ALLOWED_HOSTS if h.strip()])
# ولو خلف proxy:
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=os.environ.get("TRUSTED_PROXIES", "127.0.0.1").split(","))
```

---

### 🔴 P0-5: عنوان الـ API هارد-كودد `http://127.0.0.1:8000` في 5 ملفات
`Dashboard.jsx:72` · `AuditTrails.jsx:4` · `InfrastructureHealth.jsx:7` · `WorkloadControl.jsx:4` · `Login.jsx:18`

النتيجة: **أي حد يفتح الداشبورد من جهاز غير السيرفر = الواجهة مش هتشتغل خالص** (وبتخبّط على localhost بتاعه هو). وكمان كله HTTP بدون TLS ⇒ **توكن الـ JWT والباسورد ماشيين plaintext على الشبكة**.

**الإصلاح:**
```js
// src/api/client.js
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
export async function apiFetch(path, { token, ...opts } = {}) { /* ... */ }
```
- `.env.production`: `VITE_API_BASE_URL=https://coe.company.local`
- في التطوير: `server.proxy` في `vite.config.js` يوجّه `/api` للـ backend ⇒ يختفي CORS تماماً.
- إجبار HTTPS (HSTS) + `secure` cookie لو اتحوّل لتوكن في كوكي.

---

## 4) مشاكل مهمة (P1)

| # | المشكلة | المكان | التأثير | الإصلاح |
|---|---|---|---|---|
| 6 | تعارض تقطيع الباسورد: التشفير يقص لـ 72 بايت، والتحقق لا | `auth.py:43-49` | أي باسورد > 72 بايت **مستحيل يدخل** | `def verify_password(p, h): return pwd_context.verify(p.encode()[:72], h)` أو التبديل لـ argon2 |
| 7 | توكن الجهاز في **query string** للـ WebSocket (`?token=`) | `api.py:1522` | بيتسجل في access logs والبروكسي والـ `Referer` | اقبل الهيدر `X-Agent-Token` فقط (الـ agent يبعثه في `additional_headers`) أو استخدم `Sec-WebSocket-Protocol` |
| 8 | `except WebSocketDisconnect` فقط | `api.py:1532-1576` | أي استثناء آخر (مثلاً خطأ DB في الـ threadpool) بيسيب القناة في `active_connections` والجهاز يفضل **Online للأبد** | `try: ... finally: await manager.disconnect(machine_name)` + فحص stale في الخلفية |
| 9 | **مفيش Audit Log لفك تشفير الأسرار** | `api.py:1166-1182` | SuperAdmin يقرأ أي سر بدون أي أثر — ثغرة في مبدأ least-privilege/الامتثال | سجّل `Vault_Decrypt` في `AuditLogs` (+ سبب إلزامي) + كاشف للقراءات المتكررة غير الطبيعية |
| 10 | الترقية بلا قواعد: `Development → Production` مباشرة مسموحة | `api.py:1057-1120` | نشر نسخة غير مختبرة في الإنتاج = خطر تشغيلي كبير | State machine: `Dev → UAT → Prod` فقط + **اعتماد مزدوج للـ Prod** + منع الترقية لو النسخة ملهاش كل أسرار البيئة الهدف |
| 11 | **مفيش Endpoint لسحب/إلغاء توكن جهاز** | — | جهاز مسروق أو VM اتنسخت = توكن صالح للأبد | `POST /api/machines/{name}/revoke-agent-token` يضع `AgentToken = NULL` + إغلاق أي WS قائم + AuditLog |
| 12 | `role` نص حر بدون Enum | `auth.py:292-297` | يوزر بـ role غلط (typo) بيتعمل ومش هيقدر يعمل حاجة | `role: Literal["SuperAdmin","CoE_Manager","Auditor","Viewer"]` + جدول Roles |
| 13 | الأخطاء في الفرونت مكتومة | `Dashboard.jsx:1110`، `InfrastructureHealth.jsx:56` | المستخدم شايف بيانات قديمة وهو مش داري | Error state واضح + بانر "آخر تحديث ناجح: HH:MM" + `ErrorBoundary` + `401 → logout` مع إيقاف الطلب |
| 14 | التنبيه بأن `401` يستدعي `onLogout()` ثم **يكمل** parse | `Dashboard.jsx:1104` | ممكن يعرض خطأ الـ API كأنه بيانات | `if (res.status === 401) { onLogout(); throw new Error('unauthorized'); }` |
| 15 | Polling جاهل: داشبورد كل 15 ثانية، SLA كل 5 ثواني | `Dashboard.jsx:1157`، `WorkloadControl.jsx:44` | ضغط دائم على الداتابيز حتى لو التاب في الخلفية | إيقاف عند `document.hidden` + تباعد أُسّي عند الخطأ + WebSocket/SSE للتحديثات الفورية |
| 16 | `GET /api/dashboard-data` بينفّذ **9 استعلامات منفصلة** في كل نداء | `api.py:475-733` | Scaling سيء مع عدد المستخدمين/الفترات الطويلة | تجميع في استعلام/اثنين (CTE + `GROUPING SETS`) + كاش Redis 15-30 ثانية (Redis موجود بالفعل!) + ETag |
| 17 | **مفيش فهارس (Indexes)** في سكربت الـ DB | `rpa_dashboard.sql` | الـ JOINs على `ProcessRuns` هتتباطأ جداً مع النمو | `CREATE INDEX IX_Runs_Start_Proc ON ProcessRuns(StartTime DESC, ProcessName) INCLUDE(Status, TransactionsCount)` … إلخ |
| 18 | `LIKE f"{search}%"` بدون escaping | `api.py:428, 434` | `%` و `_` و `[` في البحث بيعملوا نتائج غريبة، والبحث prefix فقط | `search.replace('[','[[]').replace('%','[%]').replace('_','[_]')` + `ESCAPE` أو Full-text index |
| 19 | توقيتات مختلطة: الداتابيز `GETDATE()` والأجنت `utcnow()` (والمهمل أصلاً) | `api.py` + `bot_agent.py:200` | أرقام اليوم/الوردية غلط لو السيرفر مش بتوقيت محلي موحّد | كل حاجة **UTC** + عمود `TimestampUtc` + عرض بالتوقيت المحلي في الفرونت فقط |
| 20 | مساران للـ heartbeat (WS + `POST /api/agent-heartbeat`) | `api.py:1576` | كود قديم ميت وسطح صيانة/هجوم إضافي | اختار واحد (الـ WS) وامسح التاني |
| 21 | `requirements.txt` بترميز **UTF-16** + باكدجات دخيلة غير مستخدمة | `requirements.txt` | `Django==6.1.1`, `plotly`, `PyJWT`, `simplejson`, `Booktype`, `streamlit` (و`streamlit` في الواقع مش موجود؛ والأهم: **Django مش مستخدم خالص**) = سطح هجوم وصيانة وسخ | نظّف الملف (UTF-8)، شيل غير المستخدم، واستخدم `uv`/`pyproject.toml` + `pip-audit` في CI |
| 22 | `@app.on_event("startup"/"shutdown")` مهجور | `api.py:1432,1445` | هيتشال في نسخ Starlette/FastAPI جاية | انتقل لـ `lifespan` |
| 23 | **Limiter مزدوج** (`api.py:127` و `auth.py:13`) | `app.state.limiter` مش نفس الـ instance المستخدم في الراوتس | هيدرز `X-RateLimit-*` مش هتظهر صح، وسلوك غير متسق | `from api import limiter` (أو ملف `core/limiter.py`) + أضف `Retry-After` في رد 429 |
| 24 | `create-admin` بس `min_length=8` بلا سياسة | `auth.py:290` | باسوردات ضعيفة في نظام بنكي | سياسة تعقيد + منع تكرار آخر N + `must_change_password` + قفل بعد عدم استخدام |
| 25 | حد "الجهاز غير متصل" hard-coded 180 ثانية | `api.py:1337` | صعب الضبط لكل بيئة | `os.environ.get("AGENT_STALE_SECONDS", "180")` |
| 26 | `INSERT` في `AuditLogs` جوه الـ `execute_update` بيتنفّذ بـ `engine.begin()` منفصل عن العملية الأساسية في أماكن | `api.py:1018-1055` (الخزنة، الترقية) | لو الـ Audit فشل، العملية تنجح بدون أثر (عدم ذرّية) | وحّدها في `execute_transaction` واحدة مع العملية |

---

## 5) تحسينات وجودة كود (P2)

1. **تفكيك `Dashboard.jsx` (2090 سطر / 101KB)**: افصله لـ `components/` + `hooks/` (`useDashboardData`, `useProcessesPage`, `usePolling`). حالياً أي تعديل صغير = خطر كسر حاجة بعيدة. نقل الـ `<style dangerouslySetInnerHTML>` لـ `index.css`.
2. **طبقة API موحّدة في الفرونت**: ملف واحد فيه `fetch` wrapper + `Authorization` تلقائي + معالجة `401/403/429/500` + `AbortController` — هيمنع تكرار منطق الأخطاء في 5 ملفات.
3. **الواجهة **English only** مع تعليقات عربية**: في بيئة بنكية مصرية، **AR/EN + RTL** ميزة مطلوبة مش رفاهية.
4. **Code splitting**: البِلد الحالي `712 KB` في chunk واحد (203KB gzip). استخدم `React.lazy` لـ Recharts/الـ Views التانية.
5. **مفيش اختبارات ولا CI**: أضعف نقطة هندسية. ابدأ بـ `pytest` + `httpx.AsyncClient` لـ: (أ) منطق ROI/SLA، (ب) RBAC/Department scoping، (ج) مسار الـ enrollment، (د) سلبيات الأمان (401/403/429). + GitHub Actions: `ruff`, `oxlint`, `pytest`, `pip-audit`, `gitleaks`.
6. **مفيش Dockerfile / docker-compose**: تشغيل النظام حالياً معتمد على "اعرف تعمل إيه" — سجّل الـ ODBC Driver في صورة `python:3.11-slim` + `docker-compose` مع SQL Server وRedis للتطوير.
7. **مفيش نظام Migrations**: `rpa_dashboard.sql` سكربتات يدوية متفرقة فيها تكرار وتعليقات (`=====`) وبيانات تجريبية مخلوطة بالـ schema. استخدم Alembic (أو على الأقل مجلد `db/migrations/NNN__*.sql` مرتّب + جدول `SchemaVersions`).
8. **تنظيف**: `rpa-dashboard/README.md` لسه قالب Vite، `src/assets/react.svg` و`vite.svg` و`hero.png` و`App.css` غير مستخدمين، مجلد `streamlit/` فاضي (بقايا مشروع قديم)، ونسخة الـ API في الواجهة (`v2.1.0`) مختلفة عن الباك إند (`2.3.0`) وعن `AGENT_VERSION` (`2.1.1`) — وحّد رقم واحد يظهر في كل مكان.
9. **إثراء الـ Observability**: `opentelemetry-api` موجود في `requirements.txt` ومش مستخدم! أضف tracing + Correlation ID في اللوجات + `/metrics` (Prometheus) + لوجات JSON بدل نص.
10. **`clean_json_data` للقراءة فقط**: مفيش Validation على الأرقام المرجعة من الاستعلامات (يعني ممكن `NULL` يعدّي كـ 0 بصمت) — راجع حالات `ISNULL` في الـ ROI (مثلاً `BotCostPerRequest` مش موجود في `save` query).
11. **ملاحظات UI/UX**: `alert()` في أماكن والباقي Toast أنيق (وحّد على Toast)، مفيش Skeleton loading، مفيش Pagination للـ Audit Logs (بيحمّل 500 صف مرة واحدة)، ومفيش تصدير Excel رغم وجود أيقونة `Download` مستوردة بدون استخدام.
12. **توثيق**: اكتب `README.md` حقيقي في الجذر (بنية النظام، المتطلبات، متغيرات البيئة، خطوات التشغيل، مخطط الـ API) — حالياً مفيش أي وثيقة معمارية.

---

## 6) ترشيحات إضافة ميزات جديدة (مرتبة حسب القيمة/الجهد)

> الفكرة اللي بتحكم ترتيبي: عندك **داشبورد ممتاز** — بس **مسار إدخال البيانات نفسها ناقص**. عدد من الشاشات بتعرض بيانات مفيش طريقة رسمية لتغذيتها غير SQL يدوي. ده أهم فراغ وظيفي في المشروع.

### 🥇 1. Ingestion API للـ Bot Runs (أعلى قيمة على الإطلاق)
حالياً **مفيش أي endpoint** لإنشاء/تحديث صف في `ProcessRuns` (الجدول اللي كل الـ KPIs والـ ROI والتقارير مبنية عليه!) — والأجنت نفسه مش بيعمل حاجة غير الـ heartbeat.
**المقترح:**
```
POST /api/runs/start      { ProcessName, RequestID, IdempotencyKey } → RunID
POST /api/runs/{id}/complete { Status, TransactionsCount, FailureReason }
POST /api/runs/{id}/heartbeat  (اختياري لتحديث DurationMinutes)
```
+ مصادقة بتوكن بوت (نفس نموذج الـ Agent) + `Idempotency-Key` لمنع التكرار + حساب `DurationMinutes`/`TimeSavedHours`/`CostSaved` **في الـ backend** مش في البوت + كتابة في AuditLog.
**الفايدة:** كل الأرقام تبقى حقيقية وآلية بدل الإدخال اليدوي — وده بيغيّر قيمة المنتج كلها.

### 🥈 2. Ingestion للـ Queues (لتفعيل شاشة SLA/Workload)
`ProcessQueues.PendingItems` و`ActiveItems` **مفيش حاجة بتحدّثهم** (فقط `AvgItemProcessingSeconds` من مودال الـ SLA) ⇒ الشاشة بتعرض أصفار/بيانات قديمة.
`POST /api/queues/telemetry { ProcessName, PendingItems, ActiveItems, AvgItemProcessingSeconds }` + Timeline تاريخي (جدول `QueueSnapshots`) عشان تعمل شارت Backlog Trend.

### 🥉 3. محرّك التنبيهات (Alerting & Notifications)
أكبر نقص تشغيلي في Control Room حقيقي: **مفيش أي إشعار**. المستخدم لازم يكون فاتح الشاشة بنفسه.
- قواعد قابلة للضبط: جهاز Offline أكثر من X دقيقة / `SLAStatus = Breach_Risk` / معدل الفشل > Y% / نفس `FailureReason` تكرر Z مرة (بصمة للفشل المتكرر).
- قنوات: SMTP + Slack/Teams Webhook (كلها سهلة من الباك إند).
- جدول `Alerts` + حالة (Open/Acknowledged/Resolved) + Dedup/Cooldown + بانر وعرض في الداشبورد + أيقونة جرس مع عدّاد.

### 4. تشغيل وتحكم فعلي بالروبوتات (Trigger & Scheduling)
دلوقتي `RUN_BOT:` في `bot_agent.py:213` **مكومنت** ومفيش API لإرسال أوامر، فالقدرة الأساسية لنظام RPA غايبة.
- `POST /api/machines/{name}/commands` + جدول `BotCommands` بحالة (Queued → Sent → Ack/Timeout/Failed) + Confirm من الأجنت + Audit.
- جدول مهام `BotSchedules` (cron) لتشغيل دوري.
- قائمة `ALLOWED_BOTS` موجودة كفلتر أمان — كملها على السيرفر كمان (whitelist + توقيع الأمر بـ HMAC).

### 5. Promotion Guardrails + Rollback
`Dev → UAT → Prod` فقط، اعتماد مزدوج (4 أعين) للـ Prod، فحص تلقائي (هل النسخة عندها كل أسرار البيئة الهدف؟ هل اجتازت UAT بنجاح؟)، Rollback لنسخة سابقة بضغطة، وشاشة "الإصدار الحي حالياً في كل بيئة" (موجود منها جزء في `live-status`).

### 6. Observability & SRE
`/metrics` Prometheus (عدد الـ runs، زمن الاستجابة لكل endpoint، عدد الاتصالات)، Tracing بـ OpenTelemetry (موجود في الـ requirements ومعطّل)، Correlation ID، صفحة "System Health" داخلية (DB latency + Redis + عدد الـ agents المتصلة).

### 7. تقارير وتصدير
تصدير CSV/XLSX لسجلات التدقيق والـ runs + تقرير شهري ROI/قيمة مضافة PDF (بتوقيع/هوية الشركة) + **Daily Digest** إيميل الساعة 8 صباحاً (توفير الوقت/التكلفة، أعلى 5 فشل، الأجهزة اللي سقطت).

### 8. أمان مؤسسي: SSO/AD + MFA + إدارة الجلسات
- OIDC/LDAP (Active Directory) لدخول موحّد + MFA (TOTP) للمديرين.
- **Refresh Tokens** + شاشة "الجلسات النشطة" وإمكانية إنهاء أي جلسة من بعيد (حالياً JWT 60 دقيقة بدون إبطال).
- نقل التوكن من `localStorage` لـ **httpOnly + Secure Cookie** (مع CSRF token) — يمنع سرقة التوكن بـ XSS.

### 9. مصفوفة صلاحيات حقيقية (Permissions Matrix)
`require_roles("SuperAdmin","CoE_Manager")` مكتوبة يدوياً في عشرات الأماكن. جدول `Roles`/`Permissions` + `Depends(require("roi:write"))` + شاشة إدارة أدوار ⇒ تقدر تعمل دور "مشاهد للتدقيق" أو "مدير قسم" من غير نشر كود.

### 10. حماية الخزنة بشكل كامل
Versioning للأسرار، صلاحية قراءة بمدة (Just-in-Time Access) مع موافقة، تسجيل كامل للقراءات، فحص قوة/تسريب (HaveIBeenPwned k-anonymity)، انتهاء صلاحية دوري للأسرار، وإشعار للمالك عند أي قراءة.

### 11. تشغيل يدوي مع "سبب التشغيل" (Self-Service Run Console)
زر تشغيل من الداشبورد مع سبب إلزامي (Ticket ID) + سجل كامل "مين شغّل إيه وليه" + إمكانية إيقاف (Stop) + قناة موافقة للعمليات الحرجة.

### 12. نموذج تكلفة أذكى + Utilization
توزيع التوفير على القسم/البوت/العملية + شارت "التكلفة مقابل الوفر" شهري + **مؤشر استغلال الرخصة** (Runs الفعلية ÷ المتوقعة) لكشف البوتات غير المستغلة — يستخدم مباشرة في ميزانية الـ CoE.

### 13. حوكمة البيانات والاحتفاظ
`AuditLogs` و`ProcessRuns` هتوصل لملايين الصفوف بسرعة: Partitioning بالشهر + سياسة Retention (مثلاً AuditLogs سنتين، Runs سنة) + أرشيف لملفات/جداول باردة + Purge مجدول.

### 14. لمسات المنتج
Dark Mode · AR/EN + RTL · PWA (إشعارات + متابعة من الموبايل) · لوحة "أعلى أسباب الفشل" (Top Failures) · Compare Versions (أداء v1.2 مقابل v1.3) · Onboarding/Wizard للإعداد الأول.

---

## 7) خطة تنفيذ مقترحة (مرتّبة — كل مرحلة قابلة للتسليم لوحدها)

**Sprint 1 — "تنظيف أمني + تشغيل حقيقي" (3-5 أيام)**
1. `.gitignore` في الجذر + `git rm --cached` للأسرار/`.idea`/`.bak` + تدوير الأسرار + `FERNET_KEY` إجباري.
2. `ALLOWED_HOSTS` من متغيرات البيئة + ProxyHeaders.
3. `VITE_API_BASE_URL` + Vite proxy + توحيد `apiFetch` + معالجة 401/أخطاء.
4. تنظيف `requirements.txt` (UTF-8، شيل Django/plotly/Booktype) + `pip-audit`.
5. أول 10 اختبارات pytest (auth + RBAC + ROI) + GitHub Actions.

**Sprint 2 — "أداء وثبات ومراقبة" (أسبوع)**
6. فهارس الـ DB + تجميع استعلامات الداشبورد + كاش Redis + إيقاف الـ polling في الخلفية.
7. `lifespan` بدل `on_event` + `finally` في الـ WebSocket + Limiter موحّد.
8. لوجات منظمة + `/metrics` + Correlation ID.
9. Dockerfile + docker-compose + README حقيقي.

**Sprint 3 — "الميزات اللي بتغيّر قيمة المنتج" (أسبوعان)**
10. **Ingestion API للـ Runs والـ Queues** (+ تعديل الأجنت يبلّغ تلقائي).
11. **Alerting Engine** + قنوات إشعار.
12. **Trigger API** + BotCommands + تفعيل `RUN_BOT`.
13. Promotion Guardrails + Audit لفك التشفير + Revoke token.

**Backlog بعد كده:** SSO/MFA · Permissions Matrix · التقارير والتصدير · Retention/Archiving · AR/EN + Dark Mode.

---

## 8) Quick Wins (أقل من ساعة)

- [ ] `.gitignore` جذر الريبو (يمنع تسريب `agent_credentials.json`).
- [ ] `.env.example` + إزالة `.env` من التتبّع.
- [ ] `FERNET_KEY` في `.env` (يمنع ضياع الخزنة).
- [ ] `git rm -r --cached .idea RPA_Dashboard.bak streamlit && rm -rf streamlit` (توفير ~11MB وتنظيف).
- [ ] `ALLOWED_HOSTS` من env بدل hard-coded.
- [ ] نقل `API_BASE` لمتغير بيئة في 5 ملفات.
- [ ] إصلاح تقطيع الباسورد في `verify_password`.
- [ ] إضافة `try/finally` حول حلقة الـ WebSocket.
- [ ] حذف الـ endpoint المكرر `/api/agent-heartbeat` أو الـ WS.

---

### ملحق: أوامر تحقق سريعة
```bash
# فحص سلامة البايثون (نجح فعلاً)
python3 -m py_compile api.py bot_agent.py db_connection.py routers/auth.py

# بناء الواجهة (نجح فعلاً: 712KB / 203KB gzip — 0 errors)
cd rpa-dashboard && npm ci && npm run build && npx oxlint   # 28 تحذير، أهمها 8 × exhaustive-deps
```
