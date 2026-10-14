# خطة التعديل: هوية Navy/Indigo/Teal/Orange + إعادة تصميم الدشبورد

> **⚠️ تمت التسوية مع «Hybrid Premium Control Room»** (انظر `docs/HYBRID_UI_PLAN_AR.md` قسم 6):
> اعتمد الجزء الأكبر من هذه الخطة (شريط الأدوات اللاصق، صف الستة KPIs، ترويسة
> الصف الواحد، لون `#4F46E5`)، لكن **لوحة الحالة الفاتحة `.status-panel` استُبدلت
> بالـ hero الكحلي `command-hero`** وفقًا للمواصفات المُقفلة (تدرّج 45% + `#0D9488`،
> `--border: 0.07`)، وحُذف اختبار `statusPanel.test.jsx` لتعارضه مع ذلك،
> وأُعيد اختبار `commandCenterHero.test.jsx`.

> مرجع الهوية اللونية: commit `7296f76` (PR #14 — «Hybrid control-room UI: Navy · Indigo · Teal · Orange»).
> الفرع الحالي بني من `8e697ca` (PR #16 — الهوية البنفسجية Deep Violet + طبقة القرار v5).
> المطلوب: نرجع **الألوان فقط** لهوية `7296f76`، ونشيل الصفوف الزائدة، ونعيد تصميم الدشبورد بشكل كلاسيكي مرتّب.

---

## 0) خلاصة الخطة (للنشر في الـ Pull Request)

| # | البند | القرار |
|---|-------|--------|
| 1 | الألوان (سايد بار، توب بار، كروت، رسوم) | استبدال كل البنفسجي بلوحة Navy/Indigo/Teal/Orange من `7296f76` |
| 2 | الصف الثاني في الهيدر (تلميح الجولة / Ctrl+K / مساعدة) | **حذف نهائي** — الهيدر صف واحد |
| 3 | صف الـ eyebrow في الهيرو (Control Room · Private Operations + الساعة + الـ chips) | **حذف** — الساعة والحالة الحية والريفريش والتصدير ينتقلون لشريط الدشبورد |
| 4 | شكل الدشبورد | إعادة تصميم كلاسيكية مرتّبة (BI): شريط عنوان + صف KPI + لوحة حالة + طبقة القرار + التحليلات |
| 5 | الاختبارات | `npm run lint` + `npm test` (vitest) + `npm run build` + `pytest` (عقود الواجهة + الباقي) |
| 6 | التسليم | PR إلى `master` ثم **merge** بعد نجاح كل الاختبارات |

---

## 1) الهوية اللونية (Navy · Indigo · Teal · Orange)

السايد بار والتوب بار والكروت كلها بتقرأ من متغيرات CSS (`--brand`, `--surface`, `--navy`, ...)،
فلن يُلمس `Sidebar.jsx` ولا `TopNav.jsx` ولا أي مكوّن — التغيير كله في **مصدر الحقيقة**:

### 1.1 `rpa-dashboard/src/index.css`
| المتغير | قبل (بنفسجي) | بعد (Navy/Indigo) |
|---|---|---|
| `--bg` / `--bg-soft` / `--bg-deep` / `--surface-sunken` | `#f8f5ff` / `#f3eeff` / `#ebe3fb` / `#eee7fc` | `#f5f7fb` / `#eef2f8` / `#e6ecf5` / `#eaf0f7` |
| `--surface-2` / `--surface-3` | `#faf8ff` / `#f3eeff` | `#f8fafc` / `#f1f5f9` |
| `--border` / `--border-strong` / `--border-soft` | `rgba(91,33,182,…)` | `rgba(15,23,42, .06/.12/.035)` |
| `--line` | `rgba(107,91,138,.18)` | `rgba(100,116,139,.16)` |
| `--text` / `--text-soft` / `--text-muted` | `#1e0b3a` / `#3b2a5e` / `#6b5b8a` | `#14213a` / `#334155` / `#5b6b82` |
| `--brand` / `--brand-strong` / `--brand-lighter` | `#5b21b6` / `#4c1d95` / `#7c3aed` | `#4f46e5` / `#3730a3` / `#6366f1` |
| `--brand-soft` / `--brand-ring` | `rgba(91,33,182,.12/.40)` | `rgba(79,70,229,.1/.38)` |
| `--navy` / `--navy-deep` | `#2e1065` / `#1e0b3a` | `#1e3a5f` / `#122339` |
| `--hero-from/mid/to` (light) | `#1e0b3a` / `#4c1d95` / `#6d28d9` | `#122339` / `#1e3a5f` / `#0d9488` |
| `--hero-from/mid/to` (dark) | `#0b0618` / `#2e1065` / `#5b21b6` | `#0a1626` / `#1e3a5f` / `#0f766e` |
| `--mesh-1` / `--mesh-2` | بنفسجي | `rgba(79,70,229,.12)` / `rgba(13,148,136,.1)` |
| `--strip-*` | بنفسجي/فوشيا | Navy `#1e3a5f`, Indigo `#4f46e5`, Blue `#3b82f6`, Teal `#0d9488` (dark: `#7da3d6/#818cf8/#60a5fa/#2dd4bf`) |
| `--chart-1..6` | `#5b21b6, #8b5cf6, #c026d3, #0ea5e9, #f58220, #4c1d95` | `#4f46e5, #0d9488, #f59e0b, #e0479e, #0ea5e9, #8b5cf6` |
| `.dark` كلها |.canvas `#0b0618`, surface `#130b24`, brand `#a78bfa` | canvas `#0f1a2e`, surface `#152238/#1b2a44/#223556`, brand `#818cf8`, text `#eff5ff`, muted `#98a8bf` |

البرتقالي `--orange: #f58220` والتيركواز `--accent: #0d9488` كما هي (جزء من اللوحة المطلوبة).

### 1.2 بقية مصادر اللون
- `src/design-system/tokens.js` → نفس قيم `7296f76` (light + dark + `effects` + `chart`).
- `tailwind.config.js` → `brand-gradient` و`surface-sheen` يمزجان `--accent` بدل `--brand-lighter`.
- `index.html` → `theme-color` + خلفية الإقلاع + لون السبينر (`#F5F7FB` / `#0F1A2E` / `#4f46e5`).
- `src/context/BrandingProvider.jsx` → اللون الأساسي الافتراضي `#4F46E5`
  (مع **الإبقاء** على منطق الوضع الداكن المحسّن في PR #16 حتى لا يكسر لون المؤسسة الثيم الداكن).
- `CommandCenterHero.jsx` / أي hex بنفسجي داخل JSX (`#c4b5fd`, `#f0abfc`) → متغيرات/نغמות اللوحة الجديدة.
- الباك-إند (اللون المزروع في قاعدة البيانات والتقارير المصدّرة):
  `app/db/bootstrap.py`, `app/db/tables.py`, `app/services/export_service.py`, `app/services/organization_service.py`
  → `#5B21B6` ⇒ `#4F46E5` + ترقية الصف المزروع القديم تلقائيًا في `ensure_organization`
  (لا يلمس لونًا اختارته المؤسسة بنفسها).
- التوثيق: `docs/DESIGN_SYSTEM.md`, `src/design-system/DESIGN_SYSTEM.md`, `docs/PREMIUM_UI_PLAN_AR.md`, `CHANGELOG.md`.

---

## 2) حذف الصفوف الزائدة

### 2.1 الهيدر (`TopBar.jsx`)
- حذف الصف الثاني بالكامل (`onboarding.tourHint` + `nav.commandHint` + `common.help`) → الهيدر يبقى صف واحد.
- بما أن الصف الثاني اختفى: labels الـ bots badge والـ top nav ترجع تظهر من `xl` بدل `2xl` (زي `7296f76`).
- الإبقاء على `ResizeObserver` الذي ينشر `--header-height` (الشريط قد يلتف على الشاشات الصغيرة، والفلاتر اللاصقة تعتمد عليه).
- حذف المفاتيح غير المستخدمة من `en.json` و`ar.json` معًا (`onboarding.tourHint`, `nav.commandHint`) حتى لا يكسر اختبار تطابق اللغتين.

### 2.2 صف الـ eyebrow في الهيرو
يُحذف `command-hero__head` بالكامل (الـ eyebrow + Live chip + ساعة السيرفر + On-premises chip + Scope + Refresh + Export).
هذه العناصر لا تضيع: تنتقل إلى **شريط الدشبورد** الجديد (بند 3.1) — وهي مكانها الطبيعي في التصميم الكلاسيكي.

---

## 3) التصميم الجديد للدشبورد (كلاسيكي مرتّب — BI)

ترتيب الصفحة من فوق لتحت:

1. **شريط الصفحة (sticky)** — كارت واحد بصفّين:
   - الصف الأول: عنوان الصفحة `dashboard.title` + تحته «آخر تحديث · النطاق»، وعلى اليمين:
     Live chip + ساعة السيرفر + On-premises chip + **تحديث** + **تصدير** + **جولة**.
   - الصف الثاني: الفلاتر (الإدارة / العملية / المدى الزمني) + مسح الفلاتر + توليد توصيات السعة.
   - لاصق تحت الهيدر مباشرة عبر `top-[var(--header-height)]`.
2. **صف مؤشرات الأداء (KPI row)** — 6 كروت بيضاء بشريط لونى علوي 4px (`--strip-*`) وأيقونة وسبارك‑لاين:
   العمليات المُؤتمتة · المعاملات · عمليات اليوم · الوقت الموفّر · القيمة الموفّرة · التشغيل الآن.
   (مكوّن جديد `KpiGrid.jsx` — نفس فكرة `7296f76` — مثبّت وغير قابل للسحب.)
3. **لوحة الحالة (Status console)** — `CommandCenterHero.jsx` بعد إعادة تصميمه كسطح فاتح:
   - **Verdict** (القرار التشغيلي) في شريط Navy متدرّج — نفس classes النغمة (`is-critical/is-degraded/is-healthy`).
   - **عدّاد النجاح الدائري** (Success gauge) + **شريط حجم التشغيل 14 يوم** + **شريط النشاط الحي** (آخر 5 عمليات).
   - شبكة 3 أعمدة ≥1280px، وعمود واحد على الموبايل.
4. **يحتاج قرارًا** — `TriageQueue` (مثبّت، كما هو).
5. **الصحة التشغيلية** — `HealthBoard` (مثبّت، كما هو).
6. **التشغيل الآن** — `ActiveRunBanner`.
7. **التحليلات والأدلة** — `WidgetGrid` (القسم الوحيد القابل للسحب/الإخفاء).
8. **أسفل الصفحة** — أعمدة الإدارات + قائمة الإعداد الأولي.

كل قسم بعنوان واضح (`SectionTitle` بـ eyebrow + عنوان + وصف) — وهذا جوهر الشكل «الكلاسيكي المرتّب».

### ملفات جديدة / معدّلة
| ملف | الإجراء |
|---|---|
| `src/components/dashboard/KpiGrid.jsx` | **جديد** — صف المؤشرات الستة |
| `src/components/dashboard/DashboardToolbar.jsx` | **جديد** — شريط العنوان + الأدوات + الفلاتر (sticky) |
| `src/components/dashboard/CommandCenterHero.jsx` | إعادة تصميم: لوحة حالة فاتحة (verdict + gauge + sparkline + ticker)، بدون صف eyebrow |
| `src/pages/DashboardPage.jsx` | إعادة تركيب الصفحة حسب الترتيب أعلاه |
| `src/components/layout/TopBar.jsx` / `TopNav.jsx` | حذف الصف الثاني + `xl` بدل `2xl` |
| `src/index.css` | اللوحة الجديدة + CSS لوحة الحالة + شريط الأدوات، وحذف CSS الـ eyebrow/KPI-strip القديمة |
| `src/i18n/locales/{en,ar}.json` | مفاتيح جديدة (`dashboard.overview.*`, `dashboard.status.*`) وحذف الميت منها |

### ما لا يتغيّر (مقصود)
- `lib/opsSignals.js` وطبقة القرار (verdict/triage/health) — منطق سليم ومُختبَر، التصميم الجديد يعرضه بشكل أوضح.
- الـ Sidebar والـ TopNav والـ Command Palette وكل الصفحات الأخرى — ترث الألوان الجديدة تلقائيًا.
- عقود الأداء: الهيرو وصف المؤشرات يبقون في الـ chunk الحرج، والرسوم الثقيلة تبقى `lazy`.

---

## 4) الاختبارات (قبل الدمج)

1. `npm run lint` (oxlint) — صفر ملاحظات.
2. `npm test` (vitest: 15 ملف) — مع تحديث التوقعات المتأثرة بالتصميم:
   - `design-system.test.jsx` → قيم اللوحة الجديدة + اختبار التباين AA.
   - `commandCenterHero.test.jsx` → يتحوّل لعقد «شريط الأدوات + لوحة الحالة» (الريفريش/التصدير/الساعة في الشريط، والـ verdict/العدّاد/النشاط في اللوحة).
   - `hybridControlRoom.test.jsx` → الـ top nav والـ bots badge كما هي + العدّاد في مكانه الجديد.
   - **جديد** `dashboardLayout.test.jsx` → يثبّت ترتيب الصفحة الكلاسيكي (شريط → KPI → حالة → قرارات → صحة → تحليلات) ووجود صف المؤشرات خارج الشبكة القابلة للسحب.
3. `npm run build` — البناء ينجح وميزانية الحزم كما هي.
4. `pytest` (كامل، coverage gate 80%) — مع تحديث `tests/test_frontend_experience_contracts.py`:
   - عقد اللوحة اللونية (قيم Navy/Indigo الجديدة في `:root` و`tokens.js`).
   - عقد الهيدر: صف واحد (لا `onboarding.tourHint` في `TopBar.jsx`).
   - عقد الدشبورد: ترتيب الطبقات + `KpiGrid` + الشريط اللاصق.
5. فحص بصري عبر `vite dev` (فاتح/داكن + عربي/إنجليزي + موبايل/ديسكتوب).

---

## 5) التسليم
- Commit على فرع `arena/341a53d2-rpa-dashboard` → push → **Pull Request** إلى `master` بوصف كامل (قبل/بعد + لقطات الاختبارات).
- بعد نجاح checks: `gh pr merge <n> --merge`.
