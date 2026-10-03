# Making sytalhas/maana-media private (owner steps, E10)

Studio's library files are GitHub release assets in `sytalhas/maana-media`.
Two branches make Studio work with the repo private:

- maana `studio-private-media` (worktree
  `/Volumes/The Wall/Coding/content-creator-wt/studio-private-media`, also
  merged locally into `learn-redesign-mockups`): the functions read release
  assets through the GitHub API with a `GITHUB_MEDIA_TOKEN` secret, and
  `studio-api` gains `POST /import {"dry_run": true}` and `POST /media-links`.
- getmaana-site `studio-private-media` (worktree
  `/Volumes/The Wall/Coding/content-creator-wt/studio-site-media`): the web app
  loads posters, videos and download links through `studio/js/media.js`, which
  asks `/media-links` for short-lived signed links and falls back to the
  original URL if the route or token is missing.

Both are safe while the repo is still public, so do the steps in this order and
flip visibility last.

## a. Create the token

1. Open https://github.com/settings/personal-access-tokens/new (fine-grained token).
2. Token name: `maana-studio-media`. Resource owner: **sytalhas**. Expiration: your choice (note the date; Studio media breaks when it expires).
3. Repository access: **Only select repositories**, pick **sytalhas/maana-media** only.
4. Permissions, Repository: **Contents: Read-only** (Metadata: Read-only is added automatically). Nothing else.
5. Generate and copy the token.

## b. Set the secret

From the maana repo folder:

```
cd "/Volumes/The Wall/Coding/maana"
supabase secrets set GITHUB_MEDIA_TOKEN=github_pat_... --project-ref vymyqrxvpzlhzpvsuhya
```

## c. Deploy the functions

From the `studio-private-media` worktree (the same code is on `learn-redesign-mockups` locally):

```
cd "/Volumes/The Wall/Coding/content-creator-wt/studio-private-media"
zsh supabase/studio_deploy.sh
```

It skips migrations that are already applied and redeploys `studio-api` and `studio-worker`.

## d. Ship the web app

Merge the getmaana-site branch to `main` (GitHub Pages deploys it):

```
cd "/Volumes/The Wall/Coding/getmaana-site"
git checkout main && git pull
git merge --no-ff studio-private-media
git push origin main
```

Wait for the Pages deploy, then hard-reload https://getmaana.com/studio.

## e. Verify (repo still public)

Signed in to https://getmaana.com/studio in the Maana workspace, open the browser
console and run:

```
const { api } = await import("/studio/js/supa.js");
await api("import", { dry_run: true });
await api("media-links", { urls: ["https://github.com/sytalhas/maana-media/releases/download/library/manifest.json"] });
```

- The dry run returns reel and asset counts and no error (it writes nothing).
- `media-links` returns a link on `objects.githubusercontent.com` or
  `release-assets.githubusercontent.com` (not the github.com URL): the token works.
  If it echoes the github.com URL, the secret is missing or the token cannot read
  the repo: fix that before step f.
- Library shows posters; open a reel and play a video; in Posts, a manual
  checklist's download link opens the file.

## f. Make the repo private

```
gh repo edit sytalhas/maana-media --visibility private --accept-visibility-change-consequences
```

## g. Verify again

1. Hard-reload Studio. Run the two console calls from step e again: same results.
2. Library posters, reel videos (play one past 5 minutes after load and seek, it
   should recover), and a checklist download link all work.
3. One TikTok inbox-draft test: Launch, pick a reel with a video, tick only
   TikTok, method "Send to the TikTok inbox as a draft", Check, Launch. In Posts
   the post should reach `inbox draft` and the TikTok app should show the draft
   (the worker downloaded the file from the private repo). Delete the draft in
   the TikTok app and cancel the post in Studio.

If anything fails after step f, make the repo public again while you look:

```
gh repo edit sytalhas/maana-media --visibility public --accept-visibility-change-consequences
```

Uploading new renders to the release still needs your own GitHub login (the
Studio token is read-only).
