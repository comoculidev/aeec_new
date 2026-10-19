# AEEC — korporativ sayt (aeec.az) və idarəetmə paneli

Azərbaycan Enerji Encinirinq ənd Konsaltinq MMC · versiya 1.5 (sayt v3.3)

Bir layihə, bir proses, bir port: sayt, admin panel və API eyni Node.js tətbiqidir.
Xarici kitabxana yoxdur (yalnız Node-un daxili modulları), build mərhələsi yoxdur.

| Ünvan | Nədir |
|---|---|
| `/` | Sayt (AZ), `/en/`, `/ru/` |
| `/admin/` | İdarəetmə paneli (giriş: `/admin/login`) |
| `/api/` | JSON API (saytın formaları və panel) |

Ətraflı texniki sənəd: [`docs/TEXNIKI.md`](docs/TEXNIKI.md) · serverə addım-addım köçürmə
(texniki olmayan oxucu üçün): [`OXU-MENI.txt`](OXU-MENI.txt).

---

## 1. Tələblər

- **Node.js 22.13 və ya daha yeni** (`node -v`). Başqa heç nə: `npm install` lazım deyil.

## 2. Lokal işə salmaq

```bash
npm start          # http://localhost:8080  sayt,  http://localhost:8080/admin/  panel
npm test           # bütün avtomatik testlər (layihənin müvəqqəti surətində işləyir)
npm run create-admin   # şifrə itəndə yeni Super Admin / şifrə
```

İlk işə salınmada `data/` qovluğu yaranır (baza, yükləmələr, ehtiyat nüsxələr) və Super Admin
üçün müvəqqəti şifrə ekranda və `data/ilk-giris.txt`-də göstərilir. Başqa port: `PORT=3000 npm start`.

## 3. Konfiqurasiya

Lokalda `.env` lazım deyil. Canlı serverdə:

```bash
cp .env.example .env && chmod 600 .env   # sonra dəyərləri doldurun
```

`.env.example` hər dəyişəni izah edir. Əsasları:

| Dəyişən | Təyinat |
|---|---|
| `BASE_URL` | Canlı ünvan (`https://aeec.az`) — məktublardakı keçidlər, `www`/`http` → `https` |
| `TRUST_PROXY` | `1` — Apache/Cloudflare arxasında (ziyarətçi IP-si `X-Real-IP`-dən) |
| `PORT`, `HOST` | Dinlənən port/ünvan (standart `8080`, `127.0.0.1`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Bildiriş məktubları. Google Workspace: `smtp.gmail.com`, `587`, `0`, `office@aeec.az`, App password |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Yalnız ilk işə salınmada — ilk Super Admin |
| `LOGIN_*`, `SESSION_*`, `PASSWORD_MIN_LENGTH`, `MAX_UPLOAD_MB` | Təhlükəsizlik limitləri |

**Real şifrələr yalnız `.env`-də saxlanılır** (`.gitignore`-dadır); kodda və `.env.example`-də
heç bir şifrə və ya açar yoxdur. Serverin daxili açarı (`data/secret.key`) ilk işə salınmada
avtomatik yaradılır.

### Şirkət məlumatları — bir mənbə

| Nə | Harada dəyişdirilir |
|---|---|
| E-poçt (office@aeec.az), telefon, ünvan | **Panel → Tənzimləmələr → Əlaqə** |
| LinkedIn, Facebook, **Instagram**, YouTube, Telegram, digər | **Panel → Tənzimləmələr → Sosial şəbəkələr** |
| Footer-də sosial keçidləri göstər/gizlət | Panel → Tənzimləmələr → Footer |
| Standart dəyərlər (yeni quraşdırma üçün) | `src/company.js` — koddakı yeganə yer |
| Menyu, footer-in quruluşu, loqo | `site-templates/partials/header.<dil>.html`, `footer.<dil>.html` |

Paneldə saxlanan dəyər dərhal saytın bütün səhifələrində (footer, Əlaqə səhifəsi, axtarış
sistemləri üçün JSON-LD) görünür. Saytdan gələn sorğuların bildiriş məktubları Tənzimləmələr →
E-poçt bildirişləri siyahısına, siyahı boşdursa Əlaqə bölməsindəki e-poçta gedir.

## 4. Ofis bölmələri (daxili, saytda görünmür)

Paneldə **OFİS** qrupu — yalnız Super Admin görür (başqa rola «İstifadəçilər və rollar»da icazə verilə bilər):

| Bölmə | Nə edir |
|---|---|
| **Sənəd reyestri** | Göndərilən sənədlərin qeydiyyatı. Rəsmi nömrə avtomatik: `indeks-sıra/ay-il` (P-004/10-26), sıra növ üzrə il boyu davam edir, yeni ildə 001-dən başlayır; eyni nömrə ikinci dəfə qəbul edilmir. **Fayl adı** nömrədən alınır: «/» → «-» (`P-004-10-26.pdf`); axtarışda həm nömrə, həm fayl adı tapılır. **Alan şəxs** — Kadrlar bazasından seçilir (vəzifəsi ilə); yoxdursa «Yeni əməkdaş» düyməsi onu Kadrlar bazasına da əlavə edir (təkrar yaradılmır). Skanlar yeni sənəd yaradılarkən və sonradan əlavə olunur (PDF/JPG/PNG, bir neçə fayl), kartda baxış, endirmə, **əvəzləmə**. Cavab izləmə, məbləğ və ödəniş vəziyyəti, illik hesabat (PDF), qeydiyyat kartı (PDF), Excel/PDF ixracı. **Excel-dən idxal**. **Skanları toplu yüklə**: fayl adı = nömrə (`P-004-10-26.pdf`; köhnə `P-004_10-26.pdf` da qəbul olunur). |
| **Kontragentlər** | Müştəri/təchizatçı kartı: VÖEN, bank rekvizitləri, əlaqə; bütün sənədləri, ödənişləri və borc qalığı; hesablaşma aktı (PDF) |
| **Gəlir və xərc** | Pul hərəkəti jurnalı: tarix, məbləğ, kateqoriya, kontragent, ödəniş üsulu, təsvir, əlaqəli sənəd (müqavilə/hesab). Qəbz/qaimə skanları qeydin kartında. **Təkrar yoxlaması** (eyni növ, məbləğ və kontragent ±3 gün → xəbərdarlıq). **Təsdiq** (`finance.approve` icazəsi) və dəyişiklik tarixçəsi; təsdiqlənmiş qeydin məbləği dəyişəndə təsdiq ləğv olunur. İcmal: açılış qalığı, gəlir, xərc, dövriyyə, bağlanış qalığı aylar üzrə; PDF hesabat |
| **Kadrlar** | **Elektron şəxsi iş**: soyad/ad/ata adı, doğum tarixi, telefon, ünvan, 3×4 foto (kəsmə ilə), şəxsiyyət vəsiqəsinin seriya/nömrəsi; vəzifə, şöbə, işə qəbul/çıxma, status; sənədlər kateqoriya üzrə (şəxsiyyət vəsiqəsi, təhsil, sertifikat, müqavilə, əmr, digər); əmrlər; şəxsi iş vərəqəsi (PDF). Şəxsi məlumatları və sənədləri yalnız `hr.personal` icazəsi olan görür |
| **Əmək haqqı** | Aylıq cədvəl: hesablanmış, gəlir vergisi, DSMF, işsizlik və tibbi sığorta (işçi/işəgötürən), ödəniləcək məbləğ avtomatik; imza yerləri ilə PDF cədvəl. Məbləğləri mühasib daxil edir — panel vergi dərəcələrini özü hesablamır |

**PDF.** Bütün siyahıların «PDF» düyməsi (Excel yanında) və çap üçün hesabatlar əvvəlcə brauzerdə
önizləmə kimi açılır, oradan çap/endirmə olunur. A4, kənar boşluqları, hər səhifədə cədvəl
başlığı, «Səhifə N / M», çap tarixi, Azərbaycan hərfləri (Liberation Sans şrifti faylın içində).
Çox sütunlu siyahılarda PDF-də əsas sütunlar çap olunur, tam siyahı Excel faylındadır.

**Fayllar** gizli saxlanılır: heç bir açıq ünvanı yoxdur, hər açılışda giriş və icazə yoxlanılır.

Seçim siyahıları (sənəd növləri və indeksləri, statuslar, göndərilmə üsulları, nəticələr, icraçılar,
gəlir/xərc kateqoriyaları) proqramçısız dəyişdirilir: **Sənəd reyestri → Siyahılar**.
Pul məbləğləri bazada qəpiklə (tam ədəd) saxlanılır — cəmlər dəqiqdir.
Kod: `src/routes/office.js` + `src/office/*.js`, `src/pdf.js`, `src/xlsx-read.js`, `admin/assets/pages-office.js`;
testlər: `test/office.test.js`, `test/office-v15.test.js`.

**WhatsApp düyməsi** (Əlaqə səhifələri): nömrə Panel → Tənzimləmələr → Əlaqə → «WhatsApp»
sahəsinə beynəlxalq formatda yazılır (+994 …), istəyə görə hazır mesaj mətni də. Nömrə boşdursa
düymə göstərilmir. Nömrə hələ daxil edilməyib.

## 5. Qovluq quruluşu

```
server.js              giriş nöqtəsi: marşrutlar, panel səhifəsi, fon işləri
src/
  config.js            .env ayarları (bütün yollar layihə daxilində)
  company.js           şirkətin əlaqə və sosial məlumatlarının standartı
  site-layout.js       saytın header/footer komponentləri + panel dəyərlərinin tətbiqi
  site-static.js       saytın verilməsi (köhnə ünvanların 301-i, başlıqlar, keş, gzip, 404)
  routes/office.js     ofis bölmələri: ümumi məlumat (meta) + aşağıdakı modulların qoşulması
  office/              registry.js, finance.js, hr.js, attachments.js (fayllar), reports.js (PDF hesabatlar), common.js
  pdf.js               PDF yaradıcısı (A4, şrift, cədvəllər, səhifə nömrələri) — xarici asılılıq yoxdur
  xlsx-read.js         Excel (.xlsx) faylının oxunması (reyestr idxalı üçün)
  site-news.js         paneldəki xəbərlərdən saytın xəbər səhifələrinin yaradılması
  settings.js          panel tənzimləmələri (qruplar, yoxlama qaydaları)
  validate.js          bütün giriş məlumatlarının yoxlanması
  auth.js, security.js sessiya, CSRF, icazələr; scrypt, TOTP, sorğu limitləri
  db.js                SQLite, sxem və miqrasiyalar
  mail.js, notify.js   SMTP göndərişi (növbə ilə), bildirişlər
  routes/              API: auth, public (sayt), content, files, requests, admin
  …                    crud, files, markdown, analytics, backup, audit, xlsx
admin/                 panelin interfeysi (vanilla JS modulları, build yoxdur)
  assets/core.js       təhlükəsiz HTML şablonu, API klienti, dialoqlar, şifrə sahəsinin göstər/gizlət düyməsi
site/                  sayt (statik HTML, 3 dil); assets/ — css, js, şəkillər, loqo
site-templates/        xəbər səhifələrinin şablonları
  partials/            header və footer komponentləri (hər dil üçün)
deploy/                Apache (`Include`) və systemd faylları
scripts/               create-admin.js
test/                  node:test testləri
docs/                  TEXNIKI.md, AUDIT-HESABATI.md
data/                  (işə salınanda yaranır, git-də yoxdur) baza, yükləmələr, nüsxələr
```

### Saytın səhifəsinə dəyişiklik etmək

- **Səhifənin öz məzmunu:** `site/<səhifə>/index.html` (məs. `site/haqqimizda/index.html`,
  `site/en/about/index.html`). Header və footer bu fayllarda yoxdur — yerində bir sətir var:
  `<!--@header page="/haqqimizda/" az="/haqqimizda/" en="/en/about/" ru="/ru/about/"-->`.
- **Menyu, footer, loqo:** `site-templates/partials/` — dəyişiklik bütün səhifələrə düşür.
- **Yeni səhifə:** mövcud səhifəni kopyalayın, `page` və dil keçidlərini düzəldin,
  `site/sitemap.xml`-ə əlavə edin, lazımdırsa menyu bəndini partials-a yazın.
- **CSS/JS:** `site/assets/css/style.css`, `site/assets/js/main.js`. Bunlar 1 il keşlənir —
  dəyişəndən sonra səhifələrdəki `?v=` nömrəsini artırın (`style.css?v=3.2`, `main.js?v=3.3`).
- **Xəbərlər:** yalnız paneldən (səhifələr avtomatik yaradılır; `site/xeberler/`, `en/news/`,
  `ru/news/` fayllarını əl ilə redaktə etməyin).

## 6. Serverdə yerləşdirmə (qısa)

1. Node.js 22 quraşdırın; qovluğu `/opt/aeec`-ə köçürün; `aeec` sistem istifadəçisi yaradın.
2. `.env`-i doldurun (`BASE_URL`, `TRUST_PROXY=1`, SMTP).
3. `deploy/aeec.service` → `/etc/systemd/system/`, `systemctl enable --now aeec`.
4. Apache VirtualHost-a `Include /opt/aeec/deploy/apache-aeec.conf`; modullar:
   `proxy proxy_http headers remoteip setenvif`.
5. Cloudflare: Rocket Loader söndürülsün, keşi bir dəfə təmizləyin.
6. Yoxlama: sayt, `/admin/`, Panel → Tənzimləmələr → Təhlükəsizlik (IP «Düzgün»),
   E-poçt bildirişləri → «Sınaq məktubu göndər».

Ətraflı əmrlər: `OXU-MENI.txt`, bölmə 2.

**Yeniləmə:** yeni qovluğu köhnənin üzərinə yazın, amma `data/` və `.env`-ə toxunmayın;
`chown -R aeec:aeec /opt/aeec && systemctl restart aeec`. Bazanın miqrasiyaları avtomatik işləyir.

## 7. Təhlükəsizlik (qısa)

scrypt şifrələr · HttpOnly/SameSite=Strict/`__Host-` kuki · CSRF nişanı + Origin yoxlaması ·
parametrli SQL · CSP · fayl məzmununun yoxlanması · brute-force bloku · 2FA (TOTP) ·
dəyişdirilə bilməyən audit jurnalı · sosial keçidlər üçün domen yoxlaması. Ətraflı: `docs/TEXNIKI.md` §6.

Saxlanmış şifrə heç vaxt göstərilmir (bazada yalnız heşi var). Paneldəki «göz» düyməsi yalnız
o an yazılan şifrəni göstərir; unudulan şifrə «Şifrəni unutmusunuz?» (e-poçtla keçid) və ya
Super Admin tərəfindən müvəqqəti şifrə ilə yenilənir.
