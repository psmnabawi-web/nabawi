# Firestore Schema

Semua dokumen konten punya `storeId`:

- `storeId = "<id store>"` → milik satu store.
- `storeId = "ALL"` → brand-wide. Bisa dibaca semua Store Manager.

Kolom **Writer** menunjukkan siapa yang boleh menulis:

- `client` = aplikasi web, dengan validasi `firestore.rules`.
- `server` = Cloud Functions (Admin SDK).

Semua timestamp memakai `serverTimestamp()`.

## users/{uid}

| Field | Tipe | Keterangan | Writer |
|---|---|---|---|
| uid, name, email | string | Profil | server (bootstrapProfile / manageUser), user hanya bisa ubah `name` |
| role | `super_admin` \| `marketing_manager` \| `store_manager` | Role | server |
| storeId | string \| null | Store yang di-assign (wajib untuk store_manager) | server |
| active | boolean | `false` = akun dinonaktifkan (Auth juga di-disable) | server |
| photoURL | string \| null | Foto (Google) | server |
| createdAt, updatedAt, lastLoginAt | timestamp | | server |

## stores/{storeId}

ID berupa slug, misalnya `cat-xyz-jakarta`.

| Field | Tipe | Writer |
|---|---|---|
| storeId | string (= doc id) | client (super admin) |
| storeName | string ≤100 | client (super admin) |
| address | string ≤300 | client (super admin) |
| city | string ≤80 | client (super admin) |
| status | `active` \| `inactive` | client (super admin) |
| createdAt, updatedAt, updatedBy | | client |

## social_sources/{id} — Modul 1

| Field | Tipe | Writer |
|---|---|---|
| platform | `TikTok` \| `Instagram` \| `YouTube` | client (marketing/admin) |
| sourceType | `content` \| `account` \| `hashtag` | client |
| url | https URL (wajib kecuali hashtag) | client |
| keyword | string ≤100 (wajib untuk hashtag) | client |
| category | `paint` \| `interior` \| `exterior` \| `waterproofing` \| `renovation` \| `color-trend` \| `home-decor` \| `building-material` | client |
| competitor | string ≤100 | client |
| location | string ≤100 | client |
| contentSample | caption/transkrip/catatan ≤3000 | client |
| storeId | string | client |
| createdBy, createdAt, updatedAt, updatedBy | | client |
| lastAnalyzedAt, lastTrendId, lastTrendName, lastTrendScore, analysisCount | | server |

## trend_analysis/{id} — Modul 2 (`analyzeTrend`)

| Field | Tipe |
|---|---|
| sourceId, storeId, platform, keyword, category, sourceUrl | salinan dari sumber |
| sourceMeta | `{title, author, thumbnailUrl}` dari oEmbed TikTok/YouTube, atau null |
| trendName | string |
| trendScore | integer 0-100 |
| growthLevel | `Viral` \| `Rising` \| `Stable` \| `Declining` |
| viralPattern, audienceEmotion, contentPattern, hookAnalysis, visualStyle, marketingOpportunity, recommendation, rationale | string |
| suggestedFormats, keywords | string[] |
| confidence | `high` \| `medium` \| `low` |
| provider, model, createdBy, createdAt | metadata AI |

Writer: server. Client hanya boleh menghapus (marketing/admin).

## content_ideas/{id} — Modul 3 (`generateContent`)

| Field | Tipe | Writer |
|---|---|---|
| batchId, rank | grup hasil satu kali generate, urutan | server |
| trendId, trendName | referensi tren (opsional) | server |
| title, hook, storyline, cta | string | server; client boleh edit |
| expectedImpact, impactLevel (`High`/`Medium`/`Low`) | | server |
| targetAudience, format, objective, product, audience, platform | | server |
| status | `idea` \| `scripted` \| `approved` \| `archived` | server/client |
| favorite | boolean | client |
| scriptCount, lastScriptId | | server |
| storeId, provider, model, createdBy, createdAt | | server |

## video_scripts/{id} — Modul 4 (`generateScript`)

| Field | Tipe |
|---|---|
| contentId, trendId | referensi |
| title | string |
| duration | 15 \| 30 \| 60 |
| tone, platform | |
| hook | `{timeRange: "0-3s", visual, voice, onScreenText}` |
| scenes | `[{sceneNumber, timeRange, visual, voice, onScreenText}]` |
| cta | `{timeRange, visual, voice, onScreenText}` |
| voiceOver, caption, musicSuggestion | string |
| hashtags | string[] |
| storeId, provider, model, createdBy, createdAt | |

Writer: server. Client (marketing/admin) boleh mengedit title, hook, scenes, cta, voiceOver, caption, hashtags dan musicSuggestion.

## generated_videos/{id} — Modul 5 (`generateVideo`)

| Field | Tipe | Writer |
|---|---|---|
| scriptId, contentId | referensi (opsional) | server |
| title | string | server; client boleh rename |
| template | `before_after` \| `product_education` \| `store_promotion` \| `customer_testimonial` \| `color_inspiration` | server |
| templateLabel | | server |
| duration | 15 \| 30 \| 60 | server |
| ratio | `9:16` | server |
| style | `Realistic` \| `Cinematic` | server |
| provider | `veo` \| `runway` \| `kling` \| `pika` \| `heygen` \| `mock` | server |
| model | | server |
| status | `Draft` → `Processing` → `Completed` → `Published` (atau `Failed`) | server; client hanya `Completed` ⇄ `Published` |
| plan | `{segmentDurations[], voiceOverText, source}` | server |
| segments | `[{index, duration, prompt, jobId, meta, status, error, videoUrl?, storagePath?}]` | server |
| progress | `{done, total}` | server |
| videoUrl, thumbnail | URL Firebase Storage (bertoken) | server |
| storagePath, thumbnailPath | `videos/{id}/final.mp4`, `videos/{id}/thumbnail.jpg` | server |
| actualDurationSec | number | server |
| error, attempts, lease | | server |
| platform, publishedUrl, publishedAt | | client (saat publish) |
| storeId, createdBy, createdAt, updatedAt, startedAt, completedAt | | server |

## performance/{videoId}

Doc id sama dengan id video.

| Field | Tipe | Writer |
|---|---|---|
| videoId, title | | client (marketing/admin) |
| storeId | harus sama dengan `generated_videos.storeId` (dicek di rules) | client |
| platform | | client |
| views, likes, comments, shares, leads | integer ≥ 0 | client |
| salesImpact | number ≥ 0 (IDR) | client |
| engagementRate | `(likes + comments + shares) / views × 100`. Dihitung client, lalu diselaraskan oleh trigger `onPerformanceWritten` | client/server |
| publishedUrl, updatedBy, updatedAt | | client |

## campaign_calendar/{id}

| Field | Tipe |
|---|---|
| title | string ≤140 |
| date | `YYYY-MM-DD` |
| platform | |
| status | `Planned` \| `Scheduled` \| `Published` \| `Cancelled` |
| contentId, videoId | referensi opsional |
| notes | string ≤1000 |
| storeId, createdBy, createdAt, updatedAt, updatedBy | |

Writer: client (marketing/admin).

## Koleksi sistem (server-only)

| Koleksi | Isi | Dibaca oleh |
|---|---|---|
| `stats/global`, `stats/store_{storeId}` | Agregat dashboard: totals, avgEngagementRate, statusBreakdown, contentGrowth (6 bulan), platformPerformance, topContent, topTrend | global: marketing/admin. store_x: store manager store x |
| `settings/app` | textProvider, videoProvider, contentLanguage, brandContext, heygenAvatarId, heygenVoiceId | semua user aktif. Hanya super admin yang bisa menulis |
| `usage/{uid}_{yyyy-mm-dd}` | Kuota harian `{ai, video}` | pemilik & super admin |
| `audit_logs/{id}` | actor, action, entity, entityId, details, createdAt | super admin |

## Index komposit

Lihat `firestore.indexes.json`. Index ini dibutuhkan query Store Manager (`storeId in [store, 'ALL']` + orderBy), yaitu:

- `storeId + createdAt` untuk semua koleksi konten.
- `sourceId + createdAt` di `trend_analysis`.
- `contentId + createdAt` di `video_scripts`.
- `storeId + date` di `campaign_calendar`.
