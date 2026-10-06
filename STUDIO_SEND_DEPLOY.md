# Send to Studio, carousels, sound and upload quality: owner deploy steps

Built on 2026-10-06 on branches named `generator-to-studio` in three repos. Nothing here has touched production:
no migration applied, no function deployed, nothing uploaded, nothing posted. Every step below needs your
go-ahead and is run by you. Keep the request volume small: each step is one or two calls.

| Repo | Branch | Worktree |
|---|---|---|
| maana (Studio functions, migration) | `generator-to-studio` (from `learn-redesign-mockups`) | `/Volumes/The Wall/Coding/content-creator-wt/g2s-maana` |
| getmaana-site (Studio web app) | `generator-to-studio` (from `main`) | `/Volumes/The Wall/Coding/content-creator-wt/g2s-site` |
| content-creator (generator, audio, quality) | `generator-to-studio` (from `main`) | `/Volumes/The Wall/Coding/content-creator-wt/g2s-cc` |

## What it adds

- **Database** (`maana/supabase/migrations/20261006120000_studio_photo_posts.sql`, additive, re-runnable, tested on a
  local Postgres with `supabase/tests/studio_photo_posts/run.sh`; rollback `ROLLBACK_20261006_studio_photo_posts.sql`):
  `workspaces.media_release` (Maana: `sytalhas/maana-media@library`; Mawadda: empty until step 6),
  `workspaces.preflight.audio_policy` (both brands, the owner's 2026-10-06 decisions), `assets.kind 'image_set'` +
  `assets.items`, `reels.package`, `posts.format` (`video` for every existing post).
- **studio-api**: `POST /drafts` (editor; validates the package, creates the reel, image sets and one DRAFT per
  platform, runs pre-flight; never confirms), `GET /m/<post>/<n>.jpg` (HMAC-signed slide links for TikTok photo
  pulls, about 2 hours) and the TikTok URL-prefix signature file.
- **Adapters**: Instagram carousels (image containers with alt text, then CAROUSEL, resumable), Facebook multi-photo
  posts (unpublished photos, then one feed post), TikTok photo posts (PULL_FROM_URL, inbox by default,
  auto_add_music never set). YouTube: refused for image posts (its API has none).
- **Pre-flight**: carousel rules per platform, the brand audio policy (Maana: none, voice, natural SFX, recitation;
  Mawadda: the same plus vocal-only nasheed; no instruments; recitation rules), a sound the API cannot add forces the
  manual path. Video posts behave exactly as before.
- **Worker**: one quality readback per post at its first sync (what the platform serves against what was sent) and a
  `quality_drop` alert.
- **Web app**: a carousel draft shows its slides, the sound (why, licence, policy check, the step to do in the app,
  alternatives with Use this), the gate report, credits and the quality readback; manual checklists start with the
  apps' upload-quality settings.

## Steps

### 1. Merge and push the branches (nothing deploys yet)

```
cd "/Volumes/The Wall/Coding/content-creator" && git merge --no-ff generator-to-studio
cd "/Volumes/The Wall/Coding/maana" && git merge --no-ff generator-to-studio   # into learn-redesign-mockups
```

content-creator touches `cc`, `DECISIONS.md` and `engine/director/LEARNINGS.md`, which another session also edits:
resolve any conflict by keeping both sides (this branch's learnings are LRN-44 to LRN-46).

### 2. Function secret for the signed TikTok photo links

```
cd "/Volumes/The Wall/Coding/maana"
supabase secrets set STUDIO_MEDIA_KEY=$(openssl rand -hex 32) --project-ref vymyqrxvpzlhzpvsuhya
```

### 3. Migration, then functions (one script; it skips migrations already applied)

```
cd "/Volumes/The Wall/Coding/maana"
zsh supabase/studio_deploy.sh
```

Order matters: the migration first (the script does that), then `studio-api` and `studio-worker`.

### 4. Web app

```
cd "/Volumes/The Wall/Coding/getmaana-site"
git checkout main && git pull && git merge --no-ff generator-to-studio && git push origin main
```

Wait for Pages (about a minute), then hard-reload https://getmaana.com/studio.

### 5. Sign-in redirect for the local dashboard

Supabase dashboard > Authentication > URL Configuration > Redirect URLs: add
`http://localhost:4747/studio-auth.html`. The local tool signs in as you (magic link, PKCE); it never holds the
service-role key, and every Studio rail (membership per workspace, RLS, guard_posts, pre-flight, Launch by a person)
applies to it.

### 6. Mawadda's media store (before Mawadda's first send)

Mawadda has no media release yet (`brand.json studio.media_repo` is empty), so Send to Studio refuses Mawadda
until this is done. It must be private (the Aswati licence forbids redistributing its files).

```
gh repo create sytalhas/mawadda-media --private --description "Mawadda Studio media"
gh release create library --repo sytalhas/mawadda-media --title "Mawadda library" --notes "Studio media"
supabase db query --linked --project-ref vymyqrxvpzlhzpvsuhya \
  "update studio.workspaces set media_release = 'sytalhas/mawadda-media@library' where id = 'mawadda'"
```

Then give the `maana-studio-media` fine-grained token read access to `sytalhas/mawadda-media` too (GitHub >
Settings > Developer settings > the token > Repository access > add it; Contents read-only), and set
`"media_repo": "sytalhas/mawadda-media"` in `content-creator/brands/mawadda/brand.json` (`studio` block).

### 7. TikTok photo posts by API (optional; until then TikTok carousels use the checklist)

TikTok pulls photos only from a verified domain or URL prefix and follows no redirects.

1. developers.tiktok.com > your app (Mawadda shares Maana's) > Content Posting API > Manage URL properties > add
   URL prefix `https://vymyqrxvpzlhzpvsuhya.supabase.co/functions/v1/studio-api/m/`, download the signature file.
2. Serve it from Studio (file name and content from the download):
   ```
   supabase secrets set TIKTOK_URL_VERIFY_FILE=<file name> TIKTOK_URL_VERIFY_CONTENT='<file content>' --project-ref vymyqrxvpzlhzpvsuhya
   ```
   then press Verify in the TikTok portal.
3. Turn it on per workspace:
   ```
   supabase secrets set TIKTOK_PHOTO_PREFIX_VERIFIED=true MAWADDA_TIKTOK_PHOTO_PREFIX_VERIFIED=true --project-ref vymyqrxvpzlhzpvsuhya
   ```

The scopes Studio already has (`video.upload`) cover inbox photo drafts. Direct (public) posting still needs TikTok's
app audit (`TIKTOK_DIRECT_POST`, `TIKTOK_AUDITED`), as for videos. Instagram and Facebook need nothing new: the
system user token already carries `instagram_content_publish` and `pages_manage_posts`, and the Meta app stays in
development mode for our own accounts (no App Review).

### 8. Verify (small, read-only first)

1. Signed in to Studio, Maana workspace, browser console:
   ```
   const { api } = await import("/studio/js/supa.js");
   await api("drafts", { dry_run: true, package: { schema: "studio-draft/1", brand: "maana", workspace: "maana" } });
   ```
   It must refuse with "The package was not accepted" (proves the route and its checks are live; writes nothing).
2. In content-creator: `./cc dashboard`, Post generator, a passed carousel, **Send to Studio**, pick sounds,
   **Prepare and check** (local only). Sign in with the emailed link. **Send drafts to Studio** uploads the JPEGs
   to the brand's release and creates the drafts.
3. In Studio > Posts, open each draft: slides, caption, sound, gate report, pre-flight. Launch one Instagram
   carousel without a sound when you are ready; its readback appears in Details an hour later.

Known before you start: the generator's 9:16 layout (content box to y 1448) runs into its own footer band (from y
1418), so every 9:16 render of a full slide fails the footer check and TikTok sends are blocked until that layout
is fixed (content-creator commit 6a725ae; the check is right to block it).

### Rollback

Redeploy the functions that are live today (maana `84d260f`, the tip of `learn-redesign-mockups` before this merge):
`git worktree add /tmp/studio-prev 84d260f && cd /tmp/studio-prev && supabase functions deploy studio-api studio-worker --project-ref vymyqrxvpzlhzpvsuhya --no-verify-jwt`.
Revert the getmaana-site merge on `main`. Then, only if you also want the schema back, run
`supabase/migrations/ROLLBACK_20261006_studio_photo_posts.sql` (it refuses while carousel rows exist) and delete
its row from `supabase_migrations.schema_migrations`.
