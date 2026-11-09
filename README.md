# Bot Dry Run Indodax

Implementasi tugas UAS Algorithmic Trading. Semua transaksi simulasi; tidak ada API key Indodax dan tidak ada order uang sungguhan.

## Status dan batas penting

Panduan menetapkan freeze pada 4 November 2026 pukul 12.00 WIB dan forward test 4–14 November. Workspace ini mulai dikerjakan pada 9 November 2026, setelah tanggal freeze. Commit yang dibuat sekarang adalah checkpoint terlambat dengan timestamp aktual; ia bukan bukti freeze tepat waktu. Lihat [FREEZE_RECORD.md](FREEZE_RECORD.md) untuk catatan input dan bukti yang tidak tersedia. Repository ini sengaja tidak berisi log, snapshot, fee historis, atau hasil backtest fiktif. Backtest juga menolak berjalan tanpa snapshot pra-freeze dan dua sumber fee yang terverifikasi. Jangan mengaktifkan endpoint untuk mengklaim hasil UAS 10 hari penuh bila bukti tersebut tidak tersedia.

Kode memakai parameter UTS Andini (BB 25, simpangan baku 2, RSI 10, oversold 30, exit RSI 60) pada candle kripto 4 jam. Universe kandidat ditentukan dengan rata-rata turnover IDR pada 30 hari pertama dari backtest, kemudian maksimal 5 pasangan dipilih. Daftar hanya berisi pasangan yang tersedia sekarang; pasangan Indodax yang telah delisting tidak dapat ditemukan melalui API saat ini, sehingga bias survivorship historis masih perlu diungkapkan.

## Strategi dan risiko

- Long-only, tanpa leverage; modal virtual Rp100.000.000.
- Entry: pada candle 4 jam tertutup, Low menyentuh/menembus Bollinger Lower atau Close di bawahnya, serta RSI Wilder(10) < 30. Order simulasi dibuka pada ask saat tick berikutnya.
- Exit: Close menembus ke atas BB Mean (Close > MA dan Close sebelumnya <= MA sebelumnya) atau RSI > 60. Order simulasi dijual pada bid.
- Bollinger memakai 25 candle dan simpangan baku populasi 2. Sinyal live dan backtest memakai `lib/strategy.cjs` yang sama.
- Ukuran awal posisi Rp10.000.000, maksimum Rp20.000.000 per pasangan, maksimal 5 posisi, tanpa compounding.
- Daily loss limit 2% equity awal hari WIB. Saat terlampaui, entry baru dihentikan hingga pergantian hari; exit tetap berjalan. Kill switch disimpan di Upstash dan dapat dipakai tanpa deploy ulang.
- Minimum order Rp25.000. Fee memakai nilai lebih tinggi antara `/api/pairs` dan biaya taker resmi. `OFFICIAL_TAKER_FEE_PERCENT` wajib diisi setelah memeriksa sumber resmi.
- Order menyapu level bid/ask hingga kuantitas terpenuhi. Equity posisi terbuka dinilai pada best bid. Spread di atas 2%, buku kosong, candle basi, candle hilang, atau data OHLCV nol akan menolak entry dan tercatat sebagai error.
- Idempotency memakai waktu candle tertutup per pasangan dan lock Redis. Retry API dibatasi.

## Data dan hitung ulang

Gunakan Node.js LTS. Jalankan dari folder `indodax_bot`:

```powershell
npm test
npm run download
npm run select
npm run snapshot
```

`download` menarik candle 4 jam mundur per 600 bar, serial dengan jeda, untuk 10 kandidat sampai freeze. `select` memilih pasangan berdasarkan turnover di 30 hari awal backtest. `snapshot` menyimpan seluruh level buku order sebagai JSONL; jalankan minimal tiga kali sehari selama persiapan dan forward test.

Salin `data/fee-rates.example.json` menjadi `data/fee-rates.json`. Isi persentase taker dari `https://indodax.com/api/pairs` dan halaman biaya resmi `https://help.indodax.com/en/rincian-biaya-transaksi/`, termasuk URL dan tanggal akses. Buat satu rekaman per masa tarif efektif, setidaknya sebelum dan sesudah 1 Oktober 2026. Jangan isi dengan perkiraan.

Pemeriksaan 9 November 2026: `/api/pairs` melaporkan `trade_fee_percent_taker = 0.2%` pada pasangan IDR terpilih. URL rincian biaya pada soal mengembalikan HTTP 404 pada saat diperiksa, sehingga tarif resmi pembanding belum terverifikasi dan `data/fee-rates.json` sengaja tidak dibuat.

Setelah snapshot pra-freeze dan data fee lengkap, `npm run backtest` memvalidasi data minimum tiga tahun lalu menulis `data/backtest.json`. Jika prasyarat kurang, skrip berhenti dengan alasan. Setelah tanggal 14 November, tarik candle sampai akhir periode lalu jalankan `npm run replay`; skrip membandingkan return backtest pada 10 hari yang sama dan sinyal per candle dengan log bot.

## Vercel dan forward test

Tetapkan project root Vercel ke folder ini. Hubungkan Upstash Redis melalui Marketplace, lalu isi environment variables Vercel dari `.env.example`; `CRON_SECRET`, `KILL_SWITCH_SECRET`, dan token Upstash hanya di environment, jangan di file atau repositori. Endpoint `/api/tick` hanya menerima POST Bearer `CRON_SECRET`. Bot juga mensyaratkan `BOT_ENABLED=true`, `FREEZE_COMMIT` berisi hash commit freeze, dan `data/runtime-config.json` hasil seleksi yang di-commit.

Untuk timeframe 4 jam, workflow GitHub Actions `.github/workflows/tick.yml` memanggil endpoint pada menit ke-7 setiap empat jam. Isi GitHub Actions secrets `TICK_URL` (URL penuh `/api/tick`) dan `CRON_SECRET`. Catat keterlambatan scheduler dari timestamp panggilan di log.

Kill switch manual:

```powershell
$base = $env:TICK_URL -replace '/api/tick$',''
curl.exe -X POST "$base/api/kill-switch" -H "x-kill-secret: $env:KILL_SWITCH_SECRET" -H "Content-Type: application/json" -d '{"enabled":true}'
```

Gunakan `false` untuk menonaktifkannya. Tiap perubahan tercatat pada log switches.

## Audit dan dashboard

`GET /api/dashboard` mengekspor state dan log mentah. Simpan ekspor publik dari komputer lokal, lalu hitung ulang dan buat HTML offline:

```powershell
$env:DASHBOARD_URL = 'https://<domain-vercel>/api/dashboard'
npm run export-audit
npm run recalculate
npm run build-dashboard
```

`dashboard-offline.html` mandiri dan dapat dibuka tanpa internet. Metrik dihitung dari backtest, panggilan, order, trade, equity, dan snapshot. Forward replay dan benchmark hanya ditampilkan setelah data historis yang sama tersedia; angka yang belum ada tetap `--`.

Jalankan preview lokal dengan `npm run dev` (port 4173). Preview Production Vercel: https://indodax-dry-run-uas.vercel.app. Dashboard dapat dibuka publik, tetapi saat ini belum terhubung ke Upstash sehingga menampilkan state kosong. Endpoint tick tetap terkunci dan bot belum dijalankan; jangan mengaktifkannya sebelum fee resmi serta credential storage dan scheduler disiapkan. Deploy ini dibuat manual karena integrasi GitHub-Vercel belum memiliki izin repository.