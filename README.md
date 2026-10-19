# AEEC — korporativ sayt (aeec.az) və idarəetmə paneli

Azərbaycan Enerji Encinirinq ənd Konsaltinq MMC · versiya 1.4 (sayt v3.3)

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
cp .env .env && chmod 600 .env   # sonra dəyərləri doldurun
```

`.env` hər dəyişəni izah edir. Əsasları:

| Dəyişən | Təyinat |
|---|---|
| `BASE_URL` | Canlı ünvan (`https://aeec.az`) — məktublardakı keçidlər, `www`/`http` → `https` |
| `TRUST_PROXY` | `1` — Apache/Cloudflare arxasında (ziyarətçi IP-si `X-Real-IP`-dən) |
| `PORT`, `HOST` | Dinlənən port/ünvan (standart `8080`, `127.0.0.1`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Bildiriş məktubları. Google Workspace: `smtp.gmail.com`, `587`, `0`, `office@aeec.az`, App password |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Yalnız ilk işə salınmada — ilk Super Admin |
| `LOGIN_*`, `SESSION_*`, `PASSWORD_MIN_LENGTH`, `MAX_UPLOAD_MB` | Təhlükəsizlik limitləri |

**Real şifrələr yalnız `.env`-də saxlanılır** (`.gitignore`-dadır); kodda və `.env`-də
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
| **Sənəd reyestri** | Göndərilən sənədlərin qeydiyyatı. Nömrə avtomatik: `indeks-sıra/ay-il` (AE-001/09-26), sıra növ üzrə il boyu davam edir, yeni ildə 001-dən başlayır. Cavab izləmə («Gözlənilir (N gündür)»), məbləğ və ödəniş vəziyyəti, hər sənədə skan/əlavə fayllar, növlər və aylar üzrə hesabat, Excel ixracı. **Excel-dən idxal** (şirkətin `Sened_Reyestri.xlsx` faylı: əvvəl yoxlama, sonra təsdiq; mövcud nömrələr təkrarlanmır). **Skanları toplu yüklə**: fayl adı = nömrə, «/» əvəzinə «_» (`P-003_09-26.pdf`). |
| **Kontragentlər** | Müştəri/təchizatçı kartı: VÖEN, bank rekvizitləri, əlaqə; bütün sənədləri, ödənişləri və borc qalığı |
| **Gəlir və xərc** | Pul hərəkəti jurnalı (kateqoriya, üsul, ƏDV, qəbz faylı). Hesab nömrəsi yazılan ödəniş həmin sənədin ödəniş vəziyyətini yeniləyir. İllik icmal: aylar üzrə qrafik, debitor borclar, kateqoriyalar |
| **Kadrlar** | Əməkdaşlar, onlara bağlı əmrlər (reyestrdəki «Əmr» növü), əmək haqqı tarixçəsi, şəxsi iş sənədləri |
| **Əmək haqqı** | Aylıq cədvəl: hesablanmış, gəlir vergisi, DSMF, işsizlik və tibbi sığorta (işçi/işəgötürən), ödəniləcək məbləğ avtomatik. Məbləğləri mühasib daxil edir — panel vergi dərəcələrini özü hesablamır |

Seçim siyahıları (sənəd növləri və indeksləri, statuslar, göndərilmə üsulları, nəticələr, icraçılar,
gəlir/xərc kateqoriyaları) proqramçısız dəyişdirilir: **Sənəd reyestri → Siyahılar**.
Pul məbləğləri bazada qəpiklə (tam ədəd) saxlanılır — cəmlər dəqiqdir.
Kod: `src/routes/office.js`, `src/xlsx-read.js`, `admin/assets/pages-office.js`; testlər: `test/office.test.js`.

## 5. Qovluq quruluşu

```
server.js              giriş nöqtəsi: marşrutlar, panel səhifəsi, fon işləri
src/
  config.js            .env ayarları (bütün yollar layihə daxilində)
  company.js           şirkətin əlaqə və sosial məlumatlarının standartı
  site-layout.js       saytın header/footer komponentləri + panel dəyərlərinin tətbiqi
  site-static.js       saytın verilməsi (köhnə ünvanların 301-i, başlıqlar, keş, gzip, 404)
  routes/office.js     ofis bölmələri: sənəd reyestri, kontragentlər, gəlir-xərc, kadrlar, əmək haqqı
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
