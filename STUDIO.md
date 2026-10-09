# Studio (Maana and Mawadda)

The marketing command centre for **Maana** and **Mawadda**: library of reels, launches to Instagram, Facebook, YouTube Shorts and TikTok, experiments, a content calendar and live insights. Served at **https://getmaana.com/studio/** (`noindex`, team sign-in only). Each product is a **workspace**, logically isolated: its own reels, posts, accounts, keys, settings, numbers and team roles.

## Architecture

| Part | Where | Notes |
|---|---|---|
| Web app | `getmaana-site/studio/` | Static ES modules, no build step. GitHub Pages serves it from `main`. `build.py` never touches this folder. Hash routing (`#/w/<workspace>/<view>`, e.g. `#/w/mawadda/library`) because Pages has no SPA fallback. |
| Database | Supabase project `vymyqrxvpzlhzpvsuhya` (the app's production project), schema **`studio`** only | Migrations in `maana/supabase/migrations/20260930*_studio_*.sql`. Nothing touches app tables. RLS on every table. |
| Server code | Edge Functions `studio-api` and `studio-worker` | Source in `maana/supabase/functions/`. Platform adapters in `_shared/platforms/`. |
| Scheduling | `pg_cron` job `studio-worker` (every minute) | Calls `studio.kick_worker()`, which only wakes the worker when a job is due. `studio-health` runs daily at 06:17 UTC. |
| Realtime | Supabase Realtime on the `studio` tables | Every teammate sees status, metrics and experiment changes without a refresh. The green dot in the sidebar shows the live connection. |
| Tokens | Supabase Vault (`studio.secret_put` / `secret_get`, service role only) and Edge Function secrets | Tokens never reach the browser. `studio.connections` holds health only. |
| Videos | GitHub Release `library` in the repo `sytalhas/maana-media` (can be private) | Free, 2 GB per file. Supabase stores only URLs. Uploaded by `maana/marketing/studio/import_library.py --upload`. The functions read it with the `GITHUB_MEDIA_TOKEN` secret; the web app loads posters, videos and downloads through `studio/js/media.js`, which swaps release URLs for short-lived signed links from `POST /media-links` (and keeps the original URL if that route or the token is missing). See `STUDIO_PRIVATE_MEDIA_DEPLOY.md`. |

### Workspaces

`studio.workspaces` holds one row per product (`maana`, `mawadda`): name, app ids (`ios_app_id`, `android_id`, `bundle_id`), `palette` (CSS custom properties), `logo_url`, `fonts`, `copy` (brand copy: studio name, domain, privacy and terms URLs, support email, store links, sample handles), `preflight` (brand copy rules), `levers` (vocabularies and the lever fields the UI shows) and `media_manifest_url`. Migration: `maana/supabase/migrations/20261003120000_studio_workspaces.sql` (review notes in `maana/supabase/STUDIO_WORKSPACES_REVIEW.md`).

- **Isolation.** Every `studio` table has `workspace_id` (existing rows are `maana`). Roles are per workspace (`studio.members` is keyed by `(workspace_id, email)`), and every RLS policy checks the row's workspace, so a Mawadda-only member never sees a Maana row. Keys and tokens are stored per workspace too.
- **Switcher.** The top of the sidebar (and the phone top bar) shows the workspace logo and name, with a segmented **Maana | Mawadda** control when the person belongs to more than one. People only see workspaces they are members of; a single-workspace member sees no switcher.
- **Routing.** `#/w/<workspace>/<view>[/rest][?query]`. Old links (`#/library`) open in the current workspace, else the last one used on this device (`localStorage studio.lastWorkspace`), else Maana if the person is a member, else their first workspace. A workspace the person is not a member of redirects with a notice. In code, build links with `href("posts?post=…")` from `js/store.js`.
- **Data.** `js/store.js` loads one workspace at a time: memberships from `studio.claim_memberships()`, the rows the person may open from `studio.workspaces`, then every table filtered by `workspace_id`, with Realtime subscriptions filtered by `workspace_id=eq.<ws>`. Switching workspace reloads everything. Inserts always set `workspace_id`; updates and deletes keyed by text ids also filter by it. When an owner opens a workspace that has no settings yet, `studio.seed_workspace_settings(ws)` writes the defaults once.
- **API.** `api()` in `js/supa.js` adds `workspace` to every studio-api POST body and `?workspace=` to GETs. OAuth callbacks return to `#/w/<ws>/connections`.
- **Theming.** `applyTheme()` in `js/app.js` writes the workspace `palette` as CSS variables on `:root`, loads `fonts.css` (Google Fonts only), sets `--serif`/`--sans` and `document.title = copy.studio_name`. `css/studio.css` keeps Maana's values as the defaults, plus `--side` (sidebar and primary buttons), `--side-ink`, `--side-mute` and `--brand` (links). Mawadda: maroon `#7B011E` sidebar, gold `#B08A3E`, sand `#F4EEE1`, ink `#2C211B`, Fraunces + Plus Jakarta Sans.
- **Levers.** The reel editor, Library filters, Dashboard breakdowns, What's winning and Experiments use `workspaces.levers.fields` (`store: "column"` reads the `studio.reels` column, `store: "levers"` reads `reels.levers` jsonb) and the vocabularies in `levers.vocab`, which the database also enforces. Maana-only concepts (recitation added in the Instagram app) show only when `preflight.recitation_rules` is on.
- **New workspace.** Dashboard, Library, Calendar, Posts and Connections show first-run guidance ("Connect Mawadda's Instagram first") until the workspace has content.

### Carousels from the post generator ("Send to Studio")

content-creator's Post generator sends a checked carousel to its own brand's workspace as draft posts, one per
platform (Instagram, TikTok, Facebook; YouTube has no API for image posts). studio-api `POST /drafts` (editor)
validates the `studio-draft/1` package (`_shared/drafts.ts`: same brand as the workspace, slides only from the
workspace's `media_release`, per-platform slide rules in `carousel.ts`, the brand audio policy in `audio.ts`), stores
the reel (`reels.package`: source run, gate report, credits), one `image_set` asset per slide size (`assets.items`)
and the drafts (`posts.format = 'carousel'`, `options.audio`), then runs pre-flight. Nothing is confirmed: Launch
works as for any draft. Publishing: Instagram carousel containers, Facebook multi-photo posts, TikTok photo posts
pulled from signed links under the verified prefix `studio-api/m/` (inbox by default; auto_add_music is never
set). A sound the platform's API cannot add (all of them for photo posts) makes the Instagram or Facebook post
manual and is a step in the TikTok inbox checklist. The local tool signs in as a member (magic link, PKCE; refresh token in the
macOS Keychain), never with the service-role key. Deploy: `STUDIO_SEND_DEPLOY.md`.

**One click is the default (owner 2026-10-07).** Instagram and Facebook carousels arrive with **No added sound** and
publish by API. Studio > Posts shows "Carousels ready to launch" with one **Check and launch all** button per
carousel: it runs pre-flight on every draft of that carousel, shows one confirmation listing what publishes where
(and what stays manual or is blocked, with the reason), and then confirms every API draft that passed in a single
`studio.confirm_posts` call. Manual drafts are never confirmed by it; a draft whose pre-flight fails is left out;
nothing launches without that confirmation. A sound is optional: in the generator's Send to Studio window or in a
draft's Details ("Optional: add a sound by hand"), choosing one switches that platform to the manual checklist
(the APIs cannot add a sound to a carousel); "Back to no added sound" returns it to the API. Facebook manual posts
are attached afterwards with their post link (`action/facebook/attach_manual`). TikTok carousels stay manual until
TikTok verifies Studio's photo URL prefix (`docs/TIKTOK-PHOTO-VERIFY.md`), then go to the TikTok inbox.

**TikTok Direct Post screen.** When direct posting is on (`TIKTOK_DIRECT_POST`), a TikTok post's Details (and the
TikTok card in Launch) shows TikTok's required screen: the account from creator_info, a preview, editable title
and caption, privacy with no default, Comment / Duet / Stitch unticked (greyed out when the account disables them),
the commercial content disclosure, the consent declaration and the processing notice. The choices are stored in
`posts.options.tiktok`. Before the audit every direct post is private (Only me); after `TIKTOK_AUDITED` the server
refuses a direct post without these choices. Audit package: `docs/tiktok-audit/`.

### Own content from content-creator (LRN-51)

The team's own posts (a carousel or one photo designed elsewhere, or a reel video) come in through the same
`POST /drafts` route as generator carousels, from content-creator's Own content page (`engine/writers-room/own/own.py`):
optional captions, hashtags, YouTube titles and alt text written by Claude Code in the brand's voice, every brand gate
(the correctness gates also read the media), then the package. Package ids start `o-`; `reels.batch` is `own`.

- **Carousels and photos**: `format: "carousel"`, image sets as above. One photo is a set of one: Instagram publishes it
  as a single image post (same resumable container, status and publish steps); Facebook and TikTok as one photo.
- **Reels**: `format: "video"` (`_shared/drafts.ts planVideo`): one MP4 and a poster JPEG in the workspace's release
  (`<ws>-o-<item>.mp4`, already at the upload preset), one DRAFT per platform including YouTube (a title is required;
  YouTube stays private until Google's audit), TikTok to the inbox. The sound is the one in the file
  (`video.sound`, delivery `file`), checked against the brand audio policy on the way in and in pre-flight; a
  recitation is refused here (recited cuts come through the library import). The reel gets a `video` asset, so Launch
  treats it like any library reel (trial reels, paid, a schedule) and Library, levers, experiments and metrics work.
- **Posts**: "Ready to launch" (was "Carousels ready to launch") lists every package with drafts, videos included
  (`oneclick.js draftPackages`); a video draft's Details shows its sound, the checks before sending and where it came
  from (`_carousel.js packagePanel`).

### Add your own: uploads in Studio (owner 2026-10-08, content-creator LRN-52)

Library > **Add your own** (editors; `#/w/<ws>/upload`, `js/views/upload.js`, rules in `js/upload_rules.js`). A
member uploads one reel (MP4, up to 95 MB) or 1 to 10 images and writes the caption by hand: no AI captioning and no AI
brand reviewers on this path (the owner's decision). A reminder of what to check (per brand: app facts, Qur'an and
hadith word for word with the reference, no rulings, spouse wording, modesty, the sound rules) sits next to the button,
in each draft's Details and in Check and launch all; it never blocks. Studio's own pre-flight runs as for every draft.

- **Files stay in the brand's GitHub release.** The browser cannot write to GitHub, so `POST /upload?workspace=&upload=&slot=`
  (`_shared/upload.ts`) takes each file as the request body and puts it in `workspaces.media_release` with
  `GITHUB_MEDIA_WRITE_TOKEN`, else `GITHUB_MEDIA_TOKEN`; that token needs Contents: Read and write on the media repos.
  Names are built on the server (`<ws>-u-<id>-4x5-01.jpg`, `<ws>-u-<id>.mp4`, `-poster.jpg`); bytes are sniffed.
- **Time, not size, is the real limit.** An Edge Function request on the free plan stops at about 150 s, and the file
  passes through it, so `js/supa.js uploadFile` measures the speed and stops early (about 6 s in) with a plain message
  when a file cannot finish in about 130 s. Measured 2026-10-08 from a 1.5 Mbps connection: about 0.2 MB/s, so reels up
  to about 25 MB there; fibre takes the full 95 MB. Bigger files go through content-creator's Own content (no limit).
- **Images** are drawn in the browser at each platform's size (JPEG 0.95, framed in the edge colour, never cropped; a
  JPEG already at the exact size goes as it is). **Reels** go as they are; the browser makes the poster.
- **Drafts**: the page sends a `studio-draft/1` package with a `u-` id to `/drafts`: `reels.batch` `uploaded`,
  `reels.package.checked = false` and the reel flag `unchecked_upload` (a pre-flight warning). From there it is a normal
  reel: Ready to launch in Posts, Launch for reels, levers, experiments, the calendar and metrics.

### Upload quality

Studio sends the original file to every platform (resumable byte uploads for Instagram, Facebook and YouTube,
FILE_UPLOAD for TikTok video, signed links for TikTok photos and Meta Ads). At a post's first sync the worker reads
back what the platform serves (Instagram media_url, Facebook photo and video formats, TikTok video.query, YouTube
fileDetails) and raises a `quality_drop` alert when it is under 95% of what was sent. Manual checklists start with
the apps' upload-quality settings. Files reach the release through content-creator's upload presets
(`engine/shared/media_quality.py`).

### Data model (schema `studio`)

`workspaces` (one per product) · `members` (allowlist + roles per workspace) · `settings` (targets, spend cap, cadence, App Store) · `reels` (creative + levers) · `assets` (files) · `posts` (reel × platform × type, status, times, platform ids) · `metrics_snapshots` (time series; view `latest_metrics`) · `experiments` · `connections` + `connection_secrets` · `jobs` (launch and sync queue with retries) · `campaign_links` · `alerts` · `audit_log`.

### Safety rails

- **Sound** follows the workspace's `preflight.audio_policy` (owner decisions 2026-10-06): Maana no music (none, voice, natural SFX, recitation); Mawadda vocal-only (the same plus vocal-only nasheeds), no instruments; Qur'an recitation only as whole ayat the post shows, from an allowed source, never mixed with music, low, with a passing islamic-correctness fit review, never in paid.
- **Nothing is sent to the outside world without a person clicking Confirm.** Posts are created as drafts, pass pre-flight (`_shared/preflight.ts`), then `studio.confirm_posts()` records who confirmed and queues them (one call for several ids, as Launch and Check and launch all do; it is all or nothing). The worker refuses unconfirmed posts and re-runs pre-flight before publishing. Editing a confirmed post clears the confirmation.
- Browsers cannot set confirmation, pre-flight results, platform ids or publish status (trigger `studio.guard_posts`).
- Ad objects are created **paused**. Activation is a separate confirmed action and is refused if it would exceed the spend cap in Settings (default $100 total).
- Pre-flight rules come from the workspace (`workspaces.preflight`). Maana blocks: em dashes; "free plan", "Premium", "trial", "Free to start", bare "no subscription"; time-bound learning promises (TikTok, and all paid); second-person religious copy in paid (Meta personal-attributes policy); recitation cuts outside the Instagram manual path; shelved or retired reels; reels flagged `needs_rerender`; platform length and caption limits. Mawadda blocks em dashes, "no tracking", "ad-free", "exclusive content", warns on spouse-gender assumptions, and keeps the time-promise and paid second-person religion rules (no recitation rules).

## Runbook

### Deploy

```sh
# from the maana repo
supabase db query --linked --project-ref vymyqrxvpzlhzpvsuhya -f supabase/migrations/<file>.sql
supabase db query --linked --project-ref vymyqrxvpzlhzpvsuhya \
  "insert into supabase_migrations.schema_migrations (version, name) values ('<version>','<name>')"
supabase functions deploy studio-api studio-worker --project-ref vymyqrxvpzlhzpvsuhya --no-verify-jwt
```

`--no-verify-jwt` is required: OAuth callbacks and the cron call carry no user JWT. Both functions check auth themselves (`requireMember()` for users, the `x-studio-cron` secret for the worker).

Web app: commit `studio/` to `getmaana-site` `main`; Pages publishes it in about a minute.

### One-time wiring (owner)

1. **Supabase dashboard, Auth → URL Configuration → Redirect URLs:** add `https://getmaana.com/studio/` (and `http://localhost:8787/studio/` for local work).
2. **Supabase dashboard, Settings → Data API → Exposed schemas:** add `studio`.
3. Worker secret (generated locally, never pasted in chat):
   ```sh
   S=$(openssl rand -hex 32)
   supabase secrets set STUDIO_CRON_SECRET=$S --project-ref vymyqrxvpzlhzpvsuhya
   supabase db query --linked --project-ref vymyqrxvpzlhzpvsuhya "select vault.create_secret('$S','studio_cron_secret'); select vault.create_secret('https://vymyqrxvpzlhzpvsuhya.supabase.co/functions/v1/studio-worker','studio_worker_url');"
   ```

### Add a teammate

Open the workspace, then Settings → team → add their email and a role (owner, editor, viewer). Roles are per workspace: add the same email in the other workspace to give access there too. They sign in at getmaana.com/studio with a magic link. Supabase's built-in email only delivers to members of the Supabase organisation; for anyone else, add them to the Supabase org or set a custom SMTP sender first.

### Import the library

```sh
python3 marketing/studio/import_library.py            # dry run: writes marketing/studio/manifest.json
python3 marketing/studio/import_library.py --upload   # uploads changed files + manifest to sytalhas/maana-media
```

Then press **Sync library** in Studio (Maana workspace). A workspace without `media_manifest_url` (Mawadda today) has no Sync library button. Hand-edited levers are never overwritten. Batch 3 folders are picked up automatically when `<id>.mp4` lands.

### Content calendar

**Sync contract (with workspaces).** A calendar client writes one workspace's plan into `studio.reels`:

```sql
insert into studio.reels as r
  (workspace_id, id, title, batch, folder, status, planned_for, pipeline_status, word_taught, levers)
values (...)
on conflict (workspace_id, id) do update set
  planned_for     = case when r.status in ('scheduled','live','shelved','retired') then r.planned_for else excluded.planned_for end,
  pipeline_status = excluded.pipeline_status,
  folder          = coalesce(excluded.folder, r.folder),
  word_taught     = coalesce(r.word_taught, excluded.word_taught),
  levers          = r.levers || coalesce(excluded.levers, '{}'::jsonb),
  status          = case when r.status in ('scheduled','live','shelved','retired') then r.status
                         when array_position(array['idea','in_production','ready'], excluded.status)
                              > coalesce(array_position(array['idea','in_production','ready'], r.status), 0)
                           then excluded.status
                         else r.status end,
  updated_at      = now();
```

- Columns: `workspace_id` (required: `maana` or `mawadda`), `id` (calendar id, unique per workspace), `title`, `batch`, `folder`, `status` (`idea`, `in_production` or `ready` from the calendar), `planned_for` (date), `pipeline_status` (agreed, writing, filming, drafted, recorded, spliced, blocked), `word_taught` (Maana only), and optionally `levers` (jsonb, the workspace's brand levers such as Mawadda's `topic` and `audience`; values must be in `workspaces.levers.vocab` or the insert is refused).
- Rules (unchanged): `planned_for` and `status` are never overwritten while a reel is scheduled, live, shelved or retired; `status` only moves forward among idea, in_production, ready.
- The pull query must join posts within the workspace: `from studio.reels r left join studio.posts p on p.workspace_id = r.workspace_id and p.reel_id = r.id where r.workspace_id = '<ws>'`.
- The old `on conflict (id)` stops working once `20261003120000_studio_workspaces.sql` is applied (the key is now `(workspace_id, id)`).

Planned videos come from the maana repo's `marketing/content/CALENDAR.md`. Run `python3 marketing/pipeline/studio_calendar_sync.py --apply` (the `/marketing*` skills run it for you). It pushes each row from `agreed` onwards into `studio.reels`, using the calendar id (t-006) as the reel id. It sets `planned_for` and `pipeline_status`, and moves `status` only forward (idea, then in_production, then ready). It never touches a reel that is scheduled, live, shelved or retired. It also pulls post times and live status back into the file. The Calendar view shows a planned reel as a dashed "Plan" chip on its `planned_for` day until the reel has a post. Needs migration `20261001120000_studio_planned.sql`.

### Token refresh

| Platform | Token | Refresh |
|---|---|---|
| Instagram, Facebook, Meta Ads | Business Manager system user token (does not expire) | None needed. Fallback Facebook Login tokens last 60 days and are refreshed by the daily health job. |
| YouTube | Google OAuth refresh token | Access tokens refreshed automatically. Keep the consent screen **In production**: in Testing, refresh tokens die after 7 days. |
| TikTok | Access 24 h, refresh 365 days | Automatic. Reconnect once a year (an alert fires 30 days before). |
| App Store Connect | JWT from the `.p8` key (20 min) | Minted per call. Nothing stored. |

## Known platform limits (checked 2026-09-30)

| Platform | Limits |
|---|---|
| Instagram | 100 API posts per 24 h; caption 2,200 chars, 30 hashtags, 20 mentions; reels 3 s to 15 min. Trial Reels supported (`trial_params`, manual or automatic graduation). Insights lag up to 48 h. `impressions` and `plays` are gone (use `views`). `reels_skip_rate` gives hook rate. Webhooks do not fire for apps in development mode, so insights are polled. |
| Facebook Page | Reels 3 to 90 s, 30 per 24 h. Page `impressions` metrics were removed; validate metric names. |
| Meta Ads | Standard (limited) access is enough for our own ad account, with tight rate limits. Playables: one HTML file up to 2 MB (zip 5 MB), App Installs objective only. No religion targeting exists; paid copy must not assert the viewer's religion. |
| YouTube | Uploads from unverified API projects stay **private until Google's audit** ([form](https://support.google.com/youtube/contact/yt_api_form)). 100 uploads per day. Shorts are automatic for vertical videos up to 3 min. `views` changed on 2026-08-27 to count every play start; `engagedViews` keeps the old method. |
| TikTok | Default path: upload to the TikTok inbox as a draft, then the owner taps Post in the app (max 5 pending per 24 h). Direct posting from an unaudited app is private only. Stats come only for public videos; no watch time. |
| App Store Connect | Campaign links (`ct`, max 30 chars) only work once the app is live and has data; the provider token appears after the first campaign link is made. Campaign installs are in the **Detailed** reports only, need 5+ users and arrive 24 to 48 h late. |

## Evidence behind the numbers

- Hook rate ≥ 30%, hold rate ≥ 40%: `maana/marketing/strategy/STRATEGY.md` (practitioner benchmarks, not education-specific).
- CPI and day-7 retention targets: not set. The app is free, so the old $0.90 break-even (priced on a subscription) no longer applies. The owner sets these in Settings once real data exists.
- All aggregates are ratio of sums. "What's winning" shows sample sizes and a two-proportion test as a caveat, never as proof: posts differ in more than one lever.
