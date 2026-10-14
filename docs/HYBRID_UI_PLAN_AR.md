# خطة الواجهة الهجينة (Hybrid Premium Control Room) — التدقيق والتنفيذ

> سؤال المستخدم: «شوف حثثت الخطة دي ولا لاء» — هذا الملف هو **التدقيق** قبل التنفيذ،
> وسجل ما نُفّذ فعلًا، وما انحرف عن الخطة ولماذا.

## 1) الحكم على الخطة قبل التنفيذ (على `master`)

**الخطة الهجينة لم تكن منفّذة على `master` — لا الهيكل ولا الألوان بالكامل.**
التحقق تم بالبحث في الكود وقت فتح هذا الـ PR:

| بند في الخطة | الحالة قبل هذا الـ PR | الدليل |
|---|---|---|
| ألوان الهوية: Navy `#1E3A5F` / Navy-deep `#122339` / Orange `#F58220` | ❌ غير موجودة | `index.css` كان يحمل هوية **بنفسجية** (`--navy: #2e1065` بنفسجي داكن، `--brand: #5b21b6`) |
| خلفية `#F5F7FB` / نص `#14213A` / muted `#5B6B82` | ❌ | `--bg: #f8f5ff` / `--text: #1e0b3a` / `--text-muted: #6b5b8a` |
| Dark `#0F1A2E` / `#152238` / `#1B2A44` | ❌ | الداكن كان `#0b0618` / `#130b24` / `#1a1030` (بنفسجي) |
| Hero بتدرّج `#122339 → #1E3A5F → #0D9488` | ❌ | `--hero-*` كان `#1e0b3a → #4c1d95 → #6d28d9` (بنفسجي) |
| KPI strip بلون الهوية (totalProcedures Navy · runsToday Green · costSaved Teal · runningNow Orange) | ⚠️ | الشرائط كانت مربوطة بحالة الـ verdict وليس بهوية الـ metric |
| Top pill nav أساسي بخمس وحدات + More | ✅ موجود مسبقًا (PR #16) | `TopNav.jsx` |
| Live badge Navy مع «● N bots online» من `/api/agents/connected` | ✅ موجود مسبقًا | `TopBar.jsx` (`BotsOnlineBadge`) |
| Hero فيه Gauge دائري + تحية زمنية + KPIs + sparkline + Refresh/Export | ✅ موجود مسبقًا | `CommandCenterHero.jsx` |
| Hero يعيد تعريف التوكنات محليًا | ⚠️ جزئيًا | كان يعيد تعريف النصوص فقط، بدون `--strip-*`/الدلالات |
| تباين AA لتدرّج الـ hero (خاصة عند الزاوية الخضراء) | ❌ | لا يوجد scrim؛ الأبيض على `#0D9488` = 3.74:1 |
| Sidebar قابل للطي ويبدأ مطويًا | ✅ موجود مسبقًا | `AppShell.jsx` (`usePersistentState('shell.collapsed', true)`) |
| خط عربي بارتفاع 1.75 بدون letter-spacing | ⚠️ | كانت قواعد RTL مبعثرة (1.35–1.5) |

> ملاحظة: `docs/PREMIUM_UI_PLAN_AR.md` تصف خطة **سابقة مختلفة** (هوية بنفسجية/Indigo)،
> وهي التي نُفّذت على `master` عبر PR #16. الخطة الهجينة طبقة تصحيحية فوقها:
> **الهوية البصرية كلها تتحول إلى Navy/Orange/Teal** مع الحفاظ على كل الهيكل الموجود.

## 2) ما نُفّذ في هذا الـ PR

### المرحلة 0 — Foundation ✅ (تحويل كامل للوحة الألوان)
- `index.css` (`:root` + `.dark`) ومرآتها في `tokens.js`:
  - Light: `--bg: #F5F7FB` · `--surface: #FFFFFF/#F8FAFC/#F1F5F9` ·
    `--border: rgba(15,23,42,0.07)` · `--text: #14213A` · `--text-muted: #5B6B82`.
  - الهوية: `--navy: #1E3A5F` · `--navy-deep: #122339` · `--orange: #F58220`.
  - brand (للأزرار فقط): Indigo مصقول `#3F51B5` — Navy يبقى لون الحضور المهيمن.
  - Dark: `#0F1A2E` / `#152238` / `#1B2A44`، شرائط أفتح، برتقالي أسطع قليلًا (`#FF9640`).
  - التدرّج المُقفل للـ hero: `--hero-from: #122339` · `--hero-mid: #1E3A5F` · `--hero-to: #0D9488`
    + `--hero-scrim` (طبقة تعتيم تضمن AA فوق الزاوية الخضراء).
- خلفية التطبيق: mesh أزرق/تركوازي (`--mesh-1` navy 10%، `--mesh-2` teal 7%) وشبكة ≤ 0.28.
- `tailwind.config.js`: `hero-gradient` و`navy-gradient` + تعليقات الهوية الجديدة.
- `index.html`: `theme-color` وشاشة الإقلاع بنفس ألوان اللوحة الجديدة.
- `BrandingProvider` + افتراضيات الـ backend لون العلامة: `#3F51B5` (قيمة عرض فقط —
  **لا تغيير في أي عقد API**).
- Utilities: `.kpi-strip` (4px)، `.nav-pill-active` (تدرّج Navy)، `.live-badge` (Navy).

### المرحلة 1 — Shell & Navigation ✅ (تأكيد + صقل)
- Top pill nav: الوحدات الخمس (`dashboard · processes · runs · alerts · capacity`)
  داخل pill أبيض، والنشط على تدرّج **Navy** + ظل ناعم (`nav-pill-active`).
- Live badge: خلفية Navy، «● N bots online» من `/api/agents/connected` الحقيقي (كل 30 ثانية).
- Sidebar يبدأ مطويًا على desktop (كما كان).

### المرحلة 2 — Hero ✅ (Navy-dominant بالكامل)
- الخلفية المطلوبة حرفيًا: `linear-gradient(135deg, #122339 0%, #1E3A5F 45%, #0D9488 100%)`
  (تُبنى من `--hero-*` — نفس النص المطلوب في العقد).
- طبقة scrim (`--hero-scrim`) خلف المحتوى: الأبيض 7.05:1 والنص الخافت 5.39:1
  عند أسوأ نقطة (الزاوية الخضراء) — موثّقة في `scripts/verify_contrast.mjs`.
- **Overrides محلية شاملة** داخل `.command-hero`: `--text`/`--surface`/`--border`/
  `--brand`/`--accent`/الدلالات/`--strip-*` — فتتكيّف كل المكونات الداخلية تلقائيًا.
- Gauge دائري (SVG) بجانب التحية في **كل المقاسات** (كان مخفيًا تحت 1280px)،
  بلون تركوازي telemetry، مع احترام `prefers-reduced-motion`.
- 5 KPIs قراريين: Success (Navy) · Active (Orange) · Savings (Teal) ·
  Runs today (Green) · SLA (Indigo) — بشريط 4px فوق كل بلاطة وأيقونة مطابقة.
- sparkline عريض بلون token (`--strip-teal`)، وRefresh/Export داخل الـ hero.

### المرحلة 3 — KPI Cards ✅ (خريطة الهوية)
- خريطة موحّدة `kpiTones` في `tokens.js`:
  `totalProcedures → Navy` · `runsToday → Green` · `costSaved → Teal` ·
  `runningNow → Orange` · `successRate → Navy` · `failedToday → Red` · `sla → Indigo` …
- تُستخدم في بلاطات الـ hero وفي `HealthBoard` — لون الـ metric ثابت، والحالة
  تحملها شارة الـ verdict (أيقونة + نص) وحدود الكارت — **اللون ليس وحده أبدًا**.

### المرحلة 4 — Arabic / RTL ✅
- `line-height: 1.75` لكل النصوص العربية (body + العناوين + بطاقات الـ hero).
- `html[dir='rtl'] * { letter-spacing: normal }` (خارج الطبقات كي يتغلب على أي utility).
- الخصائص المنطقية فقط (كما تفرضها عقود `contracts.test.jsx` و`pytest`).

### المرحلة 5–6 — Charts/Tables/Motion ✅ (تنتقل بالتوكنات)
- الجداول والرسوم تستخدم `CHART_TOKENS` فتنعكس الألوان تلقائيًا.
- `stat-flash` / `live-dot` / `card-hover` موجودة، و`prefers-reduced-motion` يوقف
  كل الحركة (بما فيها قوس الـ gauge).

### المرحلة 7 — Dark + Branding + QA ✅
- الداكن: `#0F1A2E` / `#152238` / `#1B2A44` + شرائط أفتح (`--strip-*` في `.dark`).
- `BrandingProvider` ما زال يكتب `--brand`/`--accent` فقط؛ **Navy ثابت لا يُعاد تلوينه**.

## 3) الانحرافات عن الخطة (وسببها)

1. **ألوان الدلالات كنص.** `#10B981` و `#F59E0B` و `#EF4444` تفشل 4.5:1 كنص على الأسطح
   الفاتحة (2.54 / 2.15 / 3.76). تبقى نسخ AA للنص (`#047857` / `#B45309` / `#BE123C`)،
   وتُستخدم الألوان الزاهية للشرائط والنقاط والتعبئة فقط (`--strip-*`).
2. **`--text-muted`** = `#5B6B82` وليس `#64748B`: الأخيرة 4.44:1 على `#F5F7FB` (تفشل).
3. **Orange `#F58220`** للتعبئة والشرائط فقط. كنص أبيض عليه 2.59:1، لذا لا يُستخدم كخلفية لنص.
4. **تدرّج الـ hero** مطابق للمواصفة حرفيًا، لكن تُضاف فوقه طبقة `--hero-scrim`
   لأن الأبيض على `#0D9488` وحده 3.74:1 (أقل من AA للنص العادي). التعتيم خفيف
   (34–40%) والهوية اللونية (Navy → Teal) تبقى مقروءة تمامًا.
5. **Brand actions**: الخطة تسمح بـ «Indigo مصقول» للزرار — `#3F51B5` (6.9:1 على الأبيض).
   Navy يبقى لون الحضور المهيمن في كل مكان آخر. قيمة العلامة الافتراضية في الـ backend
   حُدّثت هي أيضًا إلى `#3F51B5` (**قيمة عرض فقط** — لا تغيير في عقود API أو المخططات).
6. **الـ Sidebar** قابل للطي ويبدأ مطويًا (كما في الخطة، والعقد في `pytest` يثبّتها).
7. **Live badge** يعرض عدد **الـ agents المتصلة** (المتاح في `/api/agents/connected`)،
   وليس «البوتات العاملة الآن» — كما سبق توثيقه.
8. **KPIs الإضافية** (Exceptions / Waiting) غير موجودة في payload — لم تُختلق بيانات؛
   الـ KPIs الخمسة كلها من حقول حقيقية (`successRate`, `runningNow`, `costSaved`,
   `runsToday`, خطر SLA).
9. **لا تغيير على عقود الباك-إند** إطلاقًا (المسارات، الأشكال، الحقول كما هي).

## 4) بوابات الجودة (نتائج هذه الجولة)

| البوابة | النتيجة |
|---|---|
| `npm run lint` | ✅ 0 warnings / 0 errors |
| `npx vitest run` | ✅ 106 passed (بما فيها `design-system` و`hybridControlRoom` المحدّثة + ميزانيات الأداء) |
| `npm run build` | ✅ |
| `pytest` (الباك-إند + عقود الواجهة) | ✅ 358 passed |
| تباين WCAG (فاتح + داكن + تدرّج الـ hero بالـ scrim) | ✅ 73/73 — `node scripts/verify_contrast.mjs` |
| مزامنة CSS ↔ tokens.js | ✅ (اختبار design-system يشمل `--hero-*`) |
| عربي RTL (line-height 1.75، بدون letter-spacing) | ✅ (اختبارات design-system + rtl + عقود pytest) |

### ما لم يُختبر
- لقطات متصفح حقيقية: هذه البيئة لا تحتوي Chromium/Playwright، فالتغطية البصرية
  تمت عبر عقود الألوان المحسوبة (`verify_contrast.mjs` + اختبارات الهيكل في vitest).
- Playwright E2E الرسمي لم يُشغَّل (المتصفح غير متاح في بيئة CI هذه).

## 5) ملاحظات تشغيلية
- الشريط العلوي: تحت `lg` يبقى كما كان (زر القائمة + العنوان)؛ من `lg` وفوق يظهر الـ pill.
- لم تُغيَّر أي عقود API أو مسارات.
