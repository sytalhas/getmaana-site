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
| Videos | GitHub Release `library` in the public repo `sytalhas/maana-media` | Free, 2 GB per file. Supabase stores only URLs. Uploaded by `maana/marketing/studio/import_library.py --upload`. |

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

### Data model (schema `studio`)

`workspaces` (one per product) · `members` (allowlist + roles per workspace) · `settings` (targets, spend cap, cadence, App Store) · `reels` (creative + levers) · `assets` (files) · `posts` (reel × platform × type, status, times, platform ids) · `metrics_snapshots` (time series; view `latest_metrics`) · `experiments` · `connections` + `connection_secrets` · `jobs` (launch and sync queue with retries) · `campaign_links` · `alerts` · `audit_log`.

### Safety rails

- **Nothing is sent to the outside world without a person clicking Confirm.** Posts are created as drafts, pass pre-flight (`_shared/preflight.ts`), then `studio.confirm_posts()` records who confirmed and queues them. The worker refuses unconfirmed posts and re-runs pre-flight before publishing. Editing a confirmed post clears the confirmation.
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
