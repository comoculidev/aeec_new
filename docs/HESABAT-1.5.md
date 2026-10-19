# AEEC panel 1.5 — görülən işlər hesabatı

20.10.2026 · əvvəlki versiya 1.4 · tapşırıq: «Mövcud sistemin düzəldilməsi və funksional təkmilləşdirilməsi»

Dəyişikliklər mövcud layihəyə tətbiq olunub; mövcud məlumatlar, dizayn və funksiyalar saxlanılıb.
Başlamazdan əvvəl 1.4-ün tam nüsxəsi götürülüb (`aeec-1.4-before-1.5.tgz`). Baza yenilənərkən
tətbiq köhnə bazanın nüsxəsini özü yaradır (bax: 10-cu bənd).

## 1. Tələblər üzrə vəziyyət

| № | Tələb | Vəziyyət | Necə yoxlanılıb |
|---|---|---|---|
| 1 | Rəsmi nömrə `P-004/10-26`, fayl adı `P-004-10-26.pdf` | Hazırdır | avtomatik test 1, brauzer |
| 2 | Alan şəxs — kadrlar bazasından, vəzifəsi ilə; yeni əməkdaş formadan | Hazırdır | test 2, brauzer, yeniləmə sınağı |
| 3 | Skanlar: yaradılarkən, sonradan, baxış/endirmə/əvəzləmə, yoxlamalar | Hazırdır | test 1, `office.test.js`, brauzer |
| 4 | PDF: bütün siyahılar və çap sənədləri, Excel saxlanılıb | Hazırdır | test 3, PDF-lərin gözlə yoxlanması |
| 5 | Gəlir-xərc: sahələr, qəbz, hesabatlar, təkrar yoxlaması, təsdiq və tarixçə, sənədə bağlılıq | Hazırdır | test 4, brauzer |
| 6 | Kadrlar: elektron şəxsi iş, foto 3×4, kateqoriyalar, giriş məhdudiyyəti | Hazırdır | test 5, brauzer |
| 7 | WhatsApp düyməsi (nömrə paneldən) | Hazırdır; **nömrə daxil edilməyib** | test 6 |
| 8 | Kod keyfiyyəti və təhlükəsizlik | Hazırdır | testlər, brauzer (girişsiz fayl → 401) |
| 9 | Real testlər | 44 avtomatik test + yeniləmə sınağı + 25 brauzer yoxlaması | bax: 11-ci bənd |

## 2. Nömrə və fayl adı

- Bazada yalnız rəsmi nömrə saxlanılır (`P-004/10-26`). Fayl adı ondan hesablanır: `/` → `-`
  (`P-004-10-26.pdf`; ikinci fayl `P-004-10-26_2.jpg`).
- Nömrə formasında `p-004-10-26`, `P-004_10-26` kimi yazılış da qəbul olunur və rəsmi formaya
  çevrilir; formada dərhal ipucu görünür: «Rəsmi nömrə: P-004/10-26 · fayl adı: P-004-10-26.pdf»
  və ya «artıq başqa sənəddədir».
- Eyni nömrə ikinci dəfə qəbul edilmir (yaratma, redaktə, idxal).
- Axtarış həm `P-004/10-26`, həm `P-004-10-26` ilə tapır. Endirilən fayl nömrə adı ilə gəlir.
- Toplu skan yükləmə: `P-004-10-26.pdf`, köhnə `P-004_10-26.pdf`, `P-004-10-26 (1).pdf` — hamısı uyğunlaşdırılır.
- Mövcud nömrələr dəyişməyib; köhnə məlumat itirilməyib.

## 3. Alan şəxs

- «Alan şəxs (əməkdaş)» siyahısı kadrlar bazasından gəlir, hər adın yanında vəzifəsi.
- «Yeni əməkdaş» düyməsi (kadrlara yazma icazəsi olanda): soyad, ad, ata adı, vəzifə, telefon →
  əməkdaş Kadrlar bazasına əlavə olunur və dərhal seçilir. Eyni soyad + ad + ata adı varsa yeni
  yaradılmır, mövcud əməkdaş seçilir.
- Əmr növündə «Alan təşkilat» sahəsi gizlənir. Kadr kartındakı «Əmr» düyməsi həmin əməkdaş üçün
  əmr formasını açır.
- Köhnə sənədlərdəki sərbəst mətnli alan tərəf olduğu kimi qalıb və göstərilir.

## 4. Skanlar

- Yeni sənəd formasında skanlar seçilir və sənəd qeydə alınanda yüklənir (bir neçə fayl,
  çoxsəhifəli PDF).
- Sənəd kartında: baxış (yeni pəncərədə), endirmə, **əvəzləmə** (yeni versiya), silmə, sonradan əlavə.
- Yoxlamalar: uzantı (PDF, JPG, PNG; əlavə kimi DOCX, XLSX), faylın məzmunu (adı dəyişdirilmiş
  saxta fayl rədd olunur), ölçü limiti (`MAX_UPLOAD_MB`, standart 20 MB).

## 5. PDF

- Hər siyahıda Excel-in yanında «PDF» düyməsi: Sənəd reyestri, Kontragentlər, Gəlir-xərc,
  Kadrlar, Əmək haqqı, Xəbərlər, Layihələr, Layihə və Əlaqə sorğuları, Audit jurnalı, Analitika.
- Çap sənədləri: sənədin qeydiyyat kartı, illik reyestr hesabatı, kontragentlə hesablaşma,
  məxaric/mədaxil qeydi, illik gəlir-xərc hesabatı, şəxsi iş vərəqəsi (foto ilə), aylıq əmək
  haqqı cədvəli. İmza yerləri var.
- Hamısı A4, kənar boşluqları ilə, başlıqda şirkətin adı, hər səhifədə cədvəl başlığı təkrarlanır,
  altda «Çap tarixi» və «Səhifə N / M». Azərbaycan hərfləri düzgündür (şrift PDF-in içindədir —
  Liberation Sans, açıq lisenziya). Siyahının filtrləri başlıqda yazılır («axtarış: «…»»).
- Düymə PDF-i əvvəlcə brauzerdə **önizləmə** kimi açır; oradan çap və ya endirmə.
- PDF real məlumatdan qurulur, ekran şəkli deyil (mətn seçilir, axtarılır).
- Geniş siyahılar (məs. reyestrin 26 sütunu) A4-ə oxunaqlı sığmır: PDF-ə əsas sütunlar düşür,
  tam siyahı Excel-dədir. Sütun eni sözü yarıdan bölməyəcək qədər seçilir; boş sütunlar çıxarılır.

## 6. Gəlir və xərc

- Sahələr: tarix, növ, məbləğ, ƏDV, valyuta, kateqoriya, kontragent, ödəniş üsulu, izahat,
  bağlı sənəd (müqavilə/hesab nömrəsi — ödəniş sənədin ödəniş vəziyyətini yeniləyir).
- Qəbz/qaimə: yeni qeyd yaradılarkən və sonradan, kateqoriya ilə (qəbz, hesab-faktura, digər).
- **Təkrar yoxlaması:** eyni növ, məbləğ, valyuta və kontragent ±3 gün ərzində varsa — formada
  dərhal xəbərdarlıq, saxlayanda təsdiq dialoqu («Yenə də qeydə al»).
- **Təsdiq:** «Təsdiqlə» / «Təsdiqi ləğv et» (yalnız `finance.approve` icazəsi; Super Admin-də var).
  Təsdiqlənmiş qeydin məbləği, tarixi və s. dəyişdirilsə, təsdiq avtomatik ləğv olunur (izahatın
  dəyişməsi təsdiqi pozmur). Kartda tarixçə: kim, nə vaxt yaratdı/dəyişdi/təsdiqlədi.
- İcmal: ilin əvvəlinə qalıq, aylar üzrə gəlir, xərc, dövriyyə, ayın sonuna qalıq, kateqoriyalar,
  debitor borclar, təsdiq gözləyənlərin sayı; PDF hesabat.

## 7. Kadrlar — elektron şəxsi iş

- Şəxsi: soyad, ad, ata adı, doğum tarixi, telefon, e-poçt, ünvan, şəxsiyyət vəsiqəsinin seriya
  və nömrəsi, 3×4 foto (kəsmə pəncərəsi: çəkmə, böyütmə; 600×800 saxlanılır).
- İş: vəzifə, şöbə, işə qəbul və çıxma tarixi, status, əsas maaş; əmrlər və əməkdaşa ünvanlanan
  sənədlər reyestrdən avtomatik.
- Sənədlər kateqoriya üzrə: şəxsiyyət vəsiqəsi, təhsil, sertifikat, əmək müqaviləsi, əmr, digər.
- **Giriş:** şəxsi məlumatlar, foto və şəxsi iş sənədləri yalnız «Kadrlar: şəxsi məlumatlar»
  (`hr.personal`) icazəsi olan istifadəçiyə verilir — server bu sahələri başqalarına ümumiyyətlə
  göndərmir. Standart olaraq yalnız Super Admin.

## 8. WhatsApp

- Panel → Tənzimləmələr → Əlaqə → «WhatsApp» (beynəlxalq formatda, +994 …) və istəyə görə hazır
  mesaj (AZ/EN/RU). Nömrə yazılandan sonra Əlaqə səhifələrində (3 dildə) «WhatsApp ilə yazın»
  düyməsi çıxır, `wa.me` keçidi telefonda tətbiqi, kompüterdə WhatsApp Web-i açır.
- **Nömrə məlum olmadığı üçün daxil edilməyib**; boş olanda düymə görünmür. Ölkə kodu olmayan
  (yerli) nömrə qəbul edilmir — səhv söhbət açılmasın.

## 9. Kod və təhlükəsizlik

- Böyük `src/routes/office.js` modullara bölünüb: `src/office/` (registry, finance, hr,
  attachments, reports, common). Təkrarlanan kod (nömrə, fayl adı, ad bölgüsü, fayl siyahısı,
  PDF cədvəli) bir yerə yığılıb; fayllarda izahlar var.
- İcazələr serverdə yoxlanılır: `registry.*`, `finance.*` (+ `approve`), `hr.*` (+ `personal`).
  Yeni rol üçün ayrı-ayrı verilə bilər.
- Kadr və maliyyə faylları gizlidir: açıq URL yoxdur, hər açılışda giriş və icazə yoxlanılır;
  girişsiz → 401 (brauzerdə yoxlanılıb). PDF-lər keşlənmir (`no-store`).
- Audit jurnalına: yaratma, redaktə, təsdiq, fayl yükləmə/əvəzləmə/silmə, eksport (Excel/PDF/CSV).

## 10. Baza dəyişiklikləri və geri qaytarma

- Miqrasiya 4 (əlavə sütunlar; köhnə sütunlar silinməyib): əməkdaşa şəxsi iş sahələri, fayla
  kateqoriya, jurnala təsdiq sahələri; reyestr görünüşünə fayl adı və əməkdaşın vəzifəsi.
- Yenilənmədən əvvəl köhnə baza avtomatik `data/backups/aeec-pre-migration-v3-<vaxt>.sqlite`
  faylına köçürülür. Miqrasiya xəta versə, heç nə dəyişmir (tranzaksiya).
- Geri qaytarma qaydası: `docs/TEXNIKI.md`, 3-cü bölmə.
- Yeniləmədən sonra: «Məmmədov Elçin Rauf oğlu» kimi adlar soyad / ad / ata adı sahələrinə
  bölünür (siyahıda «Məmmədov Elçin» görünür, ata adı ayrıca sahədədir); mövcud gəlir-xərc
  qeydləri «təsdiq gözləyir» vəziyyətinə düşür — əvvəl təsdiq yox idi, ona görə avtomatik
  «təsdiqlənib» yazılmadı. Mühasib köhnə qeydləri təsdiqləməlidir.

## 11. Test nəticələri

| Sınaq | Nəticə |
|---|---|
| `npm test` — 44 test (sayt, panel API, təhlükəsizlik, ofis 1.4, ofis 1.5) | **44 / 44 keçdi** |
| Real yeniləmə: 1.4 ilə məlumat → eyni bazada 1.5 | 13 / 13: nüsxə yarandı (v3, icazə 600), əməkdaş/sənəd/jurnal qaldı, adlar bölündü, nömrə ↔ fayl adı, ikinci işə salınmada nüsxə təkrarlanmadı |
| Brauzer (Chromium), real server, real kliklər | 25 / 25: nömrə ipucu, formadan əməkdaş, skanların sənədlə yüklənməsi, endirmə adı `P-004-10-26.pdf`, əvəzləmə, fayl adı ilə axtarış, PDF önizləmə, jurnalda təkrar xəbərdarlığı və dialoq, qəbz, təsdiq + tarixçə, foto kəsmə 3:4, kateqoriyalı sənəd, girişsiz faylın 401-i, əmr formasının açılması, mobil ekran (390 px) üfüqi sürüşməsiz, WhatsApp nömrəsiz gizli |
| PDF-lər | `qpdf --check` səhvsiz; `pdftotext` Azərbaycan hərflərini düzgün çıxarır; səhifələr gözlə yoxlanılıb |

Brauzer sınağında yeganə xəta mesajı saytın Google Fonts/Maps resurslarının sınaq mühitində
bloklanması idi (internet məhdudiyyəti), tətbiqin xətası deyil.

Sınaq zamanı tapılıb düzəldilənlər: geniş cədvəllərdə başlıqların sözün ortasından bölünməsi;
boş siyahının PDF-i; audit PDF-ində saatın itməsi; tarix və IP-nin rəqəm kimi sağa düzülməsi;
gecə yarısından sonra PDF-də tarixin bir gün geri düşməsi (UTC → Bakı vaxtı); «… oğlu» adların
bölünməməsi; kiçik kartlarda fayl məlumatının sıxılması; kadr kartında «Əmrlər» başlığı altında
digər sənədlərin görünməsi.

## 12. Həll olunmamış / yoxlanılmamış

- **WhatsApp nömrəsi və Instagram ünvanı** məlum deyil — daxil edilməyib (paneldən yazılır).
- Real SMTP (Google Workspace) ilə göndəriş sınaq mühitində yoxlanılmayıb (saxta SMTP ilə yoxlanılıb).
- Brauzerin daxili PDF baxış aləti (Chrome/Edge/Safari) başlıqsız sınaq brauzerində yoxlanıla
  bilmir; PDF-in özü yoxlanılıb, önizləmə ünvanı və başlıqları testdə təsdiqlənib.
- Real telefonda WhatsApp tətbiqinin açılması yoxlanılmayıb (keçid formatı `wa.me` standartıdır).
- Əmək haqqı vergi/DSMF dərəcələri avtomatik hesablanmır — məbləğləri mühasib daxil edir.
- JPG/PNG skanlar PDF-ə birləşdirilmir (ayrıca fayl kimi saxlanılır).
- Foto kəsmə yalnız JPG/PNG qəbul edir (HEIC — iPhone formatı — əvvəlcə JPG-yə çevrilməlidir).

## 13. Dəyişən fayllar (1.4 → 1.5)

**Yeni:** `src/pdf.js`, `src/office/common.js`, `src/office/registry.js`, `src/office/finance.js`,
`src/office/hr.js`, `src/office/attachments.js`, `src/office/reports.js`,
`assets/fonts/LiberationSans-Regular.ttf`, `assets/fonts/LiberationSans-Bold.ttf`,
`assets/fonts/LICENSE.txt`, `test/office-v15.test.js`, `docs/HESABAT-1.5.md`.

**Dəyişən — server:** `src/routes/office.js` (modullara bölündü), `src/db.js` (miqrasiya 4,
avtomatik nüsxə), `src/xlsx.js` (PDF eksport), `src/crud.js`, `src/permissions.js`,
`src/settings.js`, `src/company.js`, `src/site-layout.js`, `src/routes/admin.js`,
`src/routes/requests.js`.

**Dəyişən — panel:** `admin/assets/pages-office.js`, `admin/assets/ui.js`, `admin/assets/pages.js`,
`admin/assets/pages-content.js`, `admin/assets/style.css`.

**Dəyişən — sayt:** `site/elaqe/`, `site/en/contact/`, `site/ru/contact/` (WhatsApp yeri),
`site/assets/css/style.css` (düymə); qalan səhifələrdə yalnız stil faylının versiyası (`?v=3.3`).

**Digər:** `package.json` (1.5.0, test siyahısı), `test/helpers.js`, `test/office.test.js`,
`README.md`, `OXU-MENI.txt`, `docs/TEXNIKI.md`.
