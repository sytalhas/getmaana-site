# TikTok photo posts: verify Studio's URL prefix (owner guide)

Written 2026-10-07. About 10 minutes. You do every step yourself; nothing here is pasted into a chat.

## Why this is needed

TikTok photo posts (our carousels) are pulled by TikTok itself from links Studio gives it (`PULL_FROM_URL`). TikTok
only pulls from a domain or URL prefix that the developer app has verified, over https, and it follows no
redirects. Studio's slide links live on Supabase (`supabase.co`), which we cannot verify as a whole domain (that
needs a DNS record on the domain), so we verify one **URL prefix**: TikTok then trusts every URL that starts with it.

The prefix (copy it exactly, with the slash at the end):

```
https://vymyqrxvpzlhzpvsuhya.supabase.co/functions/v1/studio-api/m/
```

For a URL prefix, TikTok gives you a small signature file (named like `tiktokAbC123....txt`) and checks it by
fetching it **at the prefix**:

```
https://vymyqrxvpzlhzpvsuhya.supabase.co/functions/v1/studio-api/m/<file name>
```

## What Studio does with it (checked in the code)

- `studio-api` (maana `supabase/functions/studio-api/index.ts`, `servePhoto`) answers `GET` and `HEAD` under `/m/`
  without sign-in. When the path is exactly `/m/<TIKTOK_URL_VERIFY_FILE>`, it returns `TIKTOK_URL_VERIFY_CONTENT`
  with status 200 and `text/plain`, no redirect. Anything else under `/m/` must be a signed slide link
  (`/m/<post id>/<n>.jpg?e=&s=`, HMAC with `STUDIO_MEDIA_KEY`, about 2 hours); everything else is a plain 404.
- Checked today (2026-10-07): `curl -i .../studio-api/m/tiktokCHECK.txt` answers `404`, `text/plain`, body
  `not found`. That is the expected answer from the deployed route while no file is set, so the route is live.
- The secrets are read on every request, so setting them needs no redeploy.
- The slide links Studio sends TikTok all start with the prefix above (`platforms/tiktok.ts` uses
  `<functions URL>/studio-api/m/`, or `TIKTOK_PHOTO_URL_PREFIX` if you ever set one; leave it unset).

## Steps

1. **Open the app.** Go to developers.tiktok.com, sign in, **Manage apps**, open the Studio app (the one whose
   client key Studio uses; Maana and Mawadda share it).
2. **Find URL properties.** In the app, open **URL properties** (TikTok calls it "Manage URL properties"; in the
   current portal it sits in the app's configuration, near the Content Posting API product, under **Verify
   properties**). Click to add a new property and choose **URL prefix** (not Domain).
3. **Enter the prefix** shown above, exactly, with `https://` and the trailing `/`.
4. **Download the signature file** TikTok offers. Do not press Verify yet. It lands in Downloads, for example
   `~/Downloads/tiktokAbC123.txt`.
5. **Give the file to Studio** (Terminal, in the maana folder; the command reads the file, so you paste nothing):
   ```sh
   cd "/Volumes/The Wall/Coding/maana"
   F=~/Downloads/tiktokAbC123.txt        # the file you just downloaded (use its real name)
   supabase secrets set TIKTOK_URL_VERIFY_FILE="$(basename "$F")" TIKTOK_URL_VERIFY_CONTENT="$(cat "$F")" \
     --project-ref vymyqrxvpzlhzpvsuhya
   ```
6. **Check it before TikTok does** (one request each):
   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" "https://vymyqrxvpzlhzpvsuhya.supabase.co/functions/v1/studio-api/m/$(basename "$F")"
   [ "$(curl -s "https://vymyqrxvpzlhzpvsuhya.supabase.co/functions/v1/studio-api/m/$(basename "$F")")" = "$(cat "$F")" ] && echo SAME
   ```
   You want `200` and `SAME`. A `404` means the file name in the secret differs from the one in the URL (check
   for spaces or a `(1)` that the browser added to a second download).
7. **Verify in TikTok.** Back in the portal, press **Verify**. The property should show as verified.
8. **Turn photo posts on in Studio**, for both workspaces (this needs the Studio send deploy done first,
   including `STUDIO_MEDIA_KEY`, STUDIO_SEND_DEPLOY.md steps 2 and 3):
   ```sh
   supabase secrets set TIKTOK_PHOTO_PREFIX_VERIFIED=true MAWADDA_TIKTOK_PHOTO_PREFIX_VERIFIED=true \
     --project-ref vymyqrxvpzlhzpvsuhya
   ```
   Keep the signature-file secrets in place afterwards: TikTok may check again.

## How to confirm it worked

- Send a new carousel from the post generator. Its TikTok draft now says **TikTok inbox** (not manual) in Studio >
  Posts, and its pre-flight passes. Drafts created before step 8 stay manual; send again or use their checklist.
- Launch that TikTok draft (on its own or with **Check and launch all**). Within a minute or two the photos appear
  as a draft in the TikTok app's inbox on the brand's account. Add the sound there if you chose one, paste the
  caption, Post, then paste the link back in Studio.
- If Launch fails with `url_ownership_unverified` or similar, step 7 did not complete: re-run step 6, then Verify.

## Maana and Mawadda

- **One app.** STUDIO_SEND_DEPLOY.md and the setup notes say Mawadda shares Maana's TikTok developer app. Studio
  reads Mawadda's keys from `MAWADDA_TIKTOK_CLIENT_KEY` (or the key saved in Mawadda's Connections), so "shared"
  means that value is the same client key as Maana's. You can check the names (not values) with
  `supabase secrets list --project-ref vymyqrxvpzlhzpvsuhya`.
- **One verification covers both.** URL properties belong to the developer app, and both workspaces' slide links
  start with the same prefix (one `studio-api` function), so one verified prefix serves both brands' accounts.
  The two `..._PHOTO_PREFIX_VERIFIED` flags are per workspace only because Studio reads every setting per
  workspace; set both.
- If Mawadda ever moves to its own TikTok app, that app needs its own verification of the same prefix, and Studio
  serves only one signature file name today (`TIKTOK_URL_VERIFY_FILE` is shared), so that would need a small code
  change first.

## What this does not change

Photo posts still go to the TikTok **inbox** (the account taps Post in the app). Public posting straight from
Studio (Direct Post) also needs TikTok's app audit (`TIKTOK_DIRECT_POST`, `TIKTOK_AUDITED`); see
`docs/tiktok-audit/README.md`.
