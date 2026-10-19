# AEEC 1.3 — kod auditi, refaktorinq və yekun hesabat

19.10.2026 · panel 1.2 → **1.3**, sayt v3.2 → **v3.3**

## 0. Auditin nəticəsi (başlanğıc vəziyyət)

| Sahə | Tapıntı |
|---|---|
| Texnologiya | Node.js 22, xarici asılılıq yoxdur (`node:sqlite`, `node:http`, `node:crypto`), build yoxdur. Sayt — statik HTML (AZ/EN/RU, 40 səhifə), panel — vanilla JS SPA, API — REST/JSON. 23 avtomatik test, hamısı keçirdi. |
| Arxitektura | Yaxşı bölünüb (`src/routes/*`, `src/*.js`), SQL parametrli, girişlər sxemlə yoxlanılır. Yeni framework əlavə etməyə ehtiyac yoxdur — bu qərar saxlanıldı. |
| Təkrarlanan kod | Header 40 nüsxə, footer 40 nüsxə (+6 xəbər şablonunda). LinkedIn/Facebook keçidləri 46 faylda, e-poçt/telefon 160+ yerdə, sayt skriptində də ayrıca. |
| Mərkəzləşdirmə | Paneldə «Sosial şəbəkələr» (Instagram daxil) və «Əlaqə» sahələri var idi, amma **sayta bağlı deyildi** — panel özü bunu xəbərdarlıqla bildirirdi. |
| Xətalar | `/api/system`: şərh sətri `mail_transport` və `site_dir` açarlarını «udurdu» → panel e-poçt üsulunu həmişə «qurulmayıb» göstərirdi. |
| E-poçt | Bildiriş məktubları standart olaraq Super Admin-in ünvanına gedirdi (office@aeec.az-a yox). Dayanıqlılıq səhifəsində (3 dil) `aeec@aeec.az`. `SMTP_FROM` standartı `noreply@aeec.az` — Google Workspace bu ünvanla göndərmir. |
| Lazımsız fayllar | 30 köhnə yönləndirmə faylı (`haqqimizda.html`, `en/xeberler.html`, `aService.html`…) — server bu ünvanları fayla baxmadan 301 ilə yönləndirir, fayllar heç vaxt verilmirdi (eyni qaydanın ikinci, ölü nüsxəsi). `site/README.txt` — tək sətirlik, açıq verilən lazımsız fayl. |
| Təhlükəsizlik | Güclü baza: scrypt, CSRF + Origin, `__Host-` kuki, CSP, fayl məzmunu yoxlaması, brute-force bloku, 2FA, dəyişdirilməz audit. SQL-də interpolasiya olunan sütun adları yalnız kod daxilindəki icazə siyahılarındandır (yoxlanıldı). Sosial keçidlər üçün `javascript:` bağlı idi, amma `http://` və istənilən domen qəbul olunurdu. |
| DNS (aeec.az, canlı yoxlama) | MX → `smtp.google.com` ✓ · SPF `include:_spf.google.com ~all` ✓ · DKIM `google._domainkey` ✓ · **DMARC yoxdur** ✗ |

## 1. Dəyişdirilmiş qovluq və fayllar

**Yeni**

| Fayl | Nə üçün |
|---|---|
| `src/company.js` | Şirkətin e-poçtu, telefonu, ünvanı (3 dil), xəritə, sosial keçidləri və sosial şəbəkələrin domen qaydaları — **koddakı yeganə mənbə** |
| `src/site-layout.js` | Header/footer komponentlərinin səhifəyə qoyulması + paneldəki əlaqə/sosial dəyərlərin bütün səhifələrə tətbiqi (yaddaşda keş, məzmun ETag-i) |
| `site-templates/partials/header.{az,en,ru}.html`, `footer.{az,en,ru}.html` | Header və footer — hər dil üçün bir fayl |
| `test/layout.test.js` | 9 yeni test (aşağıda) |
| `README.md` | Quraşdırma, konfiqurasiya, struktur, yerləşdirmə |
| `docs/REFAKTORINQ-HESABATI-1.3.md` | Bu hesabat |

**Dəyişdirilmiş**

| Fayl | Dəyişiklik |
|---|---|
| `src/settings.js` | `contact`/`social`/`general` standartları `company.js`-dən; sosial sahələrə ciddi yoxlama; saxlanma versiyası (keş üçün) |
| `src/validate.js` | `v.socialUrl()` — yalnız https, domen siyahısı, istifadəçi:şifrə hissəsi və icazəsiz simvollar qadağan |
| `src/site-static.js` | HTML səhifələr və 404 `site-layout` vasitəsilə verilir |
| `src/seed.js` | Bir dəfəlik yeniləmə: əvvəl boş saxlanmış LinkedIn/Facebook sahələri saytdakı keçidlərlə doldurulur (canlı sayt keçidləri itirməsin), audit jurnalına yazılır |
| `src/notify.js` | Bildiriş alıcısı: siyahı → **şirkət e-poçtu (office@aeec.az)** → Super Admin |
| `src/config.js` | `SMTP_FROM` standartı = `SMTP_USER` poçt qutusu (yoxdursa office@aeec.az) |
| `src/routes/admin.js` | `/api/system` xətası düzəldildi |
| `admin/assets/core.js`, `main.js`, `style.css`, `index.html` | Şifrə sahələrinə «göz» düyməsi; `eye-off` ikonu; düzgün «saytda göstərilmir» xəbərdarlıqları |
| `admin/assets/pages-content.js` | Sosial şəbəkələr bölməsi: hər sahə üçün nümunə və qayda izahı; bildiriş alıcısı izahı |
| `site/**/index.html`, `site/404.html` (40 fayl) | Header/footer → bir sətirlik direktiv; JSON-LD `sameAs` → panel; `main.js?v=3.3`, `style.css?v=3.2`; `aeec@aeec.az` → `office@aeec.az` (3 fayl); Əlaqə səhifələrinə sosial şəbəkələr sətri (3 fayl) |
| `site/assets/js/main.js` | E-poçt və telefon səhifənin footer-indən oxunur (ayrıca yazılmır) |
| `site/assets/css/style.css` | Əlaqə səhifəsindəki sosial sətir üçün 2 qayda |
| `site-templates/news-*.html` (6) | Header/footer → direktiv |
| `.env`, `OXU-MENI.txt`, `docs/TEXNIKI.md`, `package.json` | Sənədlər, Google Workspace SMTP izahı, versiya 1.3.0, yeni test faylı |
| `test/site.test.js` | Xəbər səhifəsi yoxlaması fayl əvəzinə verilən səhifə üzərindən |

**Silinmiş:** 30 ölü yönləndirmə faylı (`site/*.html`, `site/en/*.html`, `site/ru/*.html`) və
`site/README.txt`. Köhnə ünvanların hamısı əvvəlki kimi 301 verir (testlə yoxlanılır).

**Ehtiyat nüsxə:** orijinal layihə dəyişiklikdən əvvəl tam kopyalanıb; sizin göndərdiyiniz
`AEEC.zip` da toxunulmamış orijinaldır.

## 2. Əsas dəyişikliklər

1. **Header/footer komponentləri.** Hər səhifədə header və footer-in yerinə bir sətir:
   `<!--@header page="/haqqimizda/" az="/haqqimizda/" en="/en/about/" ru="/ru/about/"-->`.
   Menyu, loqo, footer keçidləri yalnız `site-templates/partials/`-də dəyişdirilir. Aktiv menyu
   bəndi və dil keçidləri avtomatik qurulur. Köçürmə zamanı bütün 46 səhifə və şablon üçün
   yoxlanıldı: standart tənzimləmələrlə verilən səhifə əvvəlki faylla **bayt-bayt eynidir**
   (dizayn və məzmun dəyişməyib).
2. **Instagram və bütün sosial şəbəkələr paneldən.** Panel → Tənzimləmələr → Sosial şəbəkələr.
   Saxlanılan kimi: bütün 40 səhifənin footer-i, Əlaqə səhifəsindəki «Sosial şəbəkələr» sətri
   (AZ/EN/RU) və axtarış sistemləri üçün JSON-LD `sameAs`. Boş sahə göstərilmir.
3. **Şirkət məlumatları bir yerdə.** E-poçt, telefon, ünvan: Panel → Tənzimləmələr → Əlaqə →
   bütün səhifələr, formaların ehtiyat mailto rejimi, sayt skriptinin mesajları, bildiriş məktubları.
   Koddakı standart dəyərlər yalnız `src/company.js`-dədir.
4. **Şifrə sahəsində «Göstər/Gizlət».** Paneldəki bütün şifrə sahələri (giriş, şifrə bərpası,
   profil, təsdiq dialoqları) avtomatik göz düyməsi alır; standart olaraq gizlidir, forma
   göndəriləndə yenidən gizlənir; ekran oxuyucu üçün `aria-pressed`/`aria-label`.
5. **E-poçt:** sorğu bildirişləri standart olaraq office@aeec.az-a; göndərən ünvan Google
   Workspace qaydasına uyğun; `.env`-də App password ilə addım-addım qurulum.

## 3. Təkrarlanan kodların mərkəzləşdirilməsi

| Əvvəl | İndi |
|---|---|
| Header 40 + 6 nüsxə | 3 fayl (`partials/header.*.html`) |
| Footer 40 + 6 nüsxə | 3 fayl (`partials/footer.*.html`) |
| LinkedIn/Facebook keçidi 46 faylda + JSON-LD 6 faylda | `src/company.js` (standart) → panel (cari dəyər). Test: koddakı başqa heç bir faylda sosial keçid yoxdur |
| E-poçt/telefon sayt skriptində ayrıca | Footer-dən oxunur |
| Köhnə ünvan yönləndirmələri: server qaydası + 30 HTML faylı | Yalnız server qaydası (`src/site-static.js`) |
| Paneldəki standart dəyərlər `settings.js`-də ayrıca yazılmışdı | `src/company.js`-dən götürülür |

## 4. Təhlükəsizlik üzrə görülən işlər

- Sosial keçidlər: yalnız `https://`; hər şəbəkə yalnız öz domenində (məs. Instagram —
  `instagram.com` və alt domenləri; `instagram.com.evil.example` rədd edilir); `user:pass@`,
  boşluq, dırnaq, `<>` rədd; `javascript:`, `data:`, `ftp:` rədd. Saytda göstərilərkən dəyər
  yenidən yoxlanılır və HTML-ekranlaşdırılır; keçidlər `rel="noopener noreferrer"`.
- Şifrə göstərmə yalnız brauzerdə yazılan mətnə aiddir; saxlanmış şifrə göstərmək mümkün deyil
  (bazada yalnız scrypt heşi). Unudulan şifrə üçün mövcud təhlükəsiz mexanizmlər saxlanılıb.
- Səhifə keşi məzmundan hesablanan ETag ilə — panel dəyişikliyi köhnə keşdə «gizlənmir».
- Komponent direktivlərinin atributları yalnız sayt daxili yollar ola bilər (başqa domen rədd).
- Kodda və `.env`-də real şifrə və açar yoxdur (yoxlanıldı).
- XSS, CSRF, SQL injection, icazə yoxlamaları, fayl yükləmələri — mövcud qorumalar yoxlanıldı,
  zəiflik tapılmadı; mövcud testlər (CSRF, XSS, açıq yönləndirmə, fayl növü) keçir.

## 5. Testlərin nəticələri

`npm test` → **32 test, 32 keçdi, 0 xəta** (23 köhnə + 9 yeni).

Yeni testlər (`test/layout.test.js`): hər səhifə və şablon komponentdən istifadə edir; heç
bir səhifədə header/footer nüsxəsi və ya sosial keçid yoxdur; bütün 40 səhifə tam qurulur
(aktiv menyu, dil keçidləri); paneldə Instagram yazılanda **hər səhifədə**, Əlaqə səhifəsində
və JSON-LD-də görünür, silinəndə yox olur, ETag dəyişir; footer-də göstər/gizlət; 11 təhlükəli
keçid rədd edilir; e-poçt/telefon/ünvan dəyişikliyi bütün səhifələrə düşür və sorğu məktubu
həmin e-poçta gedir; 1.3 yeniləməsi bir dəfə işləyir; `/api/system` düzəlişi; 30 köhnə ünvan 301;
bütün səhifələrdə qırıq daxili keçid/şəkil/fayl yoxdur.

Brauzerdə (Chromium) yoxlanıldı: 15 səhifə kompüter (1366 px) və mobil (390 px) ölçüdə —
üfüqi sürüşmə yoxdur, mobil menyu açılır, JavaScript xətası yoxdur; panelə giriş, göz düyməsi
(göstər → gizlət → göndərişdə gizlənir), profil səhifəsində 3 şifrə sahəsinin hamısında düymə,
Instagram-a `http://` keçid yazanda xəta, `https://` keçid saxlananda EN footer-də dərhal görünməsi.

### Həll olunmamış / yoxlanıla bilməyənlər

- **Real e-poçt göndərişi sınanmayıb.** SMTP şifrəsi (App password) məndə yoxdur və iş mühitindən
  Gmail serverinə çıxış bağlıdır. Göndəriş saxta SMTP serveri ilə tam yoxlanılıb (alıcı, Reply-To,
  mövzu). Canlıda: `.env`-ə App password yazın → Panel → Tənzimləmələr → E-poçt bildirişləri →
  «Sınaq məktubu göndər» → sonra saytdan bir sınaq sorğusu göndərin.
- **Instagram ünvanı** məlum deyil — uydurulmayıb; sahə boşdur, paneldən daxil edin.
- **DMARC qeydi yoxdur** (aşağıda P1).
- Google Fonts və xəritə iş mühitində yüklənmədi (şəbəkə məhdudiyyəti) — saytın öz faylları deyil.
- Real Apache/Cloudflare və canlı serverdə yoxlanılmayıb — dəyişikliklərin sayta düşməsi üçün
  yeni versiyanı serverə yükləmək lazımdır (`OXU-MENI.txt`, bölmə 3).
- Səhifələrin JSON-LD hissəsindəki strukturlaşdırılmış ünvan (`streetAddress`) paneldən dəyişmir
  (e-poçt, telefon və sosial keçidlər dəyişir).
- Footer mətni və «© 2026 …» sətri komponent faylındadır, paneldən idarə olunmur.

## 6. Əlavə təkliflər (təsdiqiniz olmadan tətbiq edilməyib)

### Prioritet 1 — Təhlükəsizlik və kritik

| Təklif | Fayda | Risk | Mürəkkəblik |
|---|---|---|---|
| **DMARC qeydi** əlavə etmək (Cloudflare DNS: `_dmarc` TXT, əvvəlcə `v=DMARC1; p=none; rua=mailto:office@aeec.az`, 2–4 həftə sonra `p=quarantine`) | aeec.az adından saxta məktubların qarşısı, məktubların spama düşməməsi | Aşağı (`p=none` heç nəyi bloklamır) | Aşağı, 10 dəq |
| SMTP-ni App password ilə qurmaq və sınaq məktubu göndərmək | Sorğular barədə dərhal xəbər tutmaq | Aşağı | Aşağı |
| Ehtiyat nüsxələrin serverdən kənara (məs. Google Drive / S3) avtomatik köçürülməsi | Server itəndə məlumat itmir — hazırda nüsxələr eyni diskdədir | Aşağı | Orta |
| Bütün Super Admin/Administrator hesablarında 2FA-nı məcburi etmək | Şifrə oğurlansa belə giriş yoxdur | Aşağı (telefon itəndə Super Admin sıfırlayır) | Aşağı |

### Prioritet 2 — Performans, texniki xidmət, kod keyfiyyəti

| Təklif | Fayda | Risk | Mürəkkəblik |
|---|---|---|---|
| GitHub + avtomatik test (hər dəyişiklikdə `npm test`) | Səhv versiyanın serverə getməsinin qarşısı | Yox | Aşağı |
| Node.js versiyasını sabitləmək (22 LTS), `node:sqlite` hələ «eksperimental»dır | Gözlənilməz yeniləmə xətalarının qarşısı | Aşağı | Aşağı |
| 2FA açarlarının bazada şifrələnmiş saxlanması | Baza oğurlansa 2FA açılmır | Aşağı | Orta |
| Yüklənən şəkillərin avtomatik kiçildilməsi (WebP) | Sürətli səhifələr, az disk | Orta (yeni modul) | Orta |
| JSON-LD ünvanının və «©» ilinin də paneldən/avtomatik gəlməsi | Tam mərkəzləşdirmə | Aşağı | Aşağı |
| Səhifələrdəki sətirdaxili `style="…"` atributlarının CSS-ə köçürülməsi | Daha sərt CSP, səliqəli kod | Aşağı (vizual yoxlama lazımdır) | Orta |

### Prioritet 3 — Yeni funksiyalar və dizayn

| Təklif | Fayda | Risk | Mürəkkəblik |
|---|---|---|---|
| Layihələr, Həllər, Haqqımızda səhifələrinin xəbərlər kimi paneldən yaradılması | Mətnləri proqramçısız dəyişmək | Orta (generator + şablonlar) | Yüksək |
| Footer mətni/copyright-ın paneldən idarəsi | Rahatlıq | Aşağı | Aşağı |
| Sosial ikonlar (mətn keçidləri əvəzinə SVG ikon) | Müasir görünüş | Aşağı | Aşağı |
| WhatsApp «yazın» düyməsi (paneldə sahə artıq var) | Sürətli əlaqə | Aşağı | Aşağı |
| AEEC Academy kurs siyahısının paneldən idarəsi (Academy işə düşəndə) | Kursların özü yenilənməsi | Orta | Orta |
