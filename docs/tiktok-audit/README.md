# TikTok app audit (Direct Post): application package

Prepared 2026-10-07 for the owner. No secrets in this folder. The owner submits everything; nothing has been sent.

## Read this first: the intended-use risk

TikTok's Content Posting API guidelines (developers.tiktok.com/doc/content-sharing-guidelines, "Intended use",
read 2026-10-07) list as **not acceptable**:

> A utility tool to help upload contents to the account(s) you or your team manages.

Studio is exactly that: our own tool for our own brands' accounts (Maana and Mawadda). The application below
describes it truthfully, and TikTok may reject the Direct Post audit for that reason alone, however compliant the
screens are. Do not describe Studio as a tool for outside creators: it is not one.

What this means in practice:

- **Without the audit** Studio already works: carousels and videos go to the brand account's TikTok **inbox** as
  drafts (after the photo URL prefix is verified, `docs/TIKTOK-PHOTO-VERIFY.md`), and someone taps Post in the
  TikTok app. That is one extra tap, and the sound can be added there too.
- **With the audit** Studio could publish publicly in one step. Worth one honest application; if TikTok refuses
  on intended use, stay on the inbox path. Every screen below is built either way and changes nothing until
  `TIKTOK_AUDITED` is set.

## TikTok's Direct Post rules against Studio

Source: content-sharing-guidelines (UX requirements). "Gap" is what Studio lacked before 2026-10-07.

| Rule | What TikTok asks | Gap found | Now in Studio |
|---|---|---|---|
| 1a | Show the creator's nickname (creator_info) | creator_info was only queried by the server at publish time; nothing shown | The TikTok screen opens with "Posting to TikTok as <nickname> @username" from a live creator_info call (studio-api `action/tiktok/creator_info`) |
| 1b | Stop and ask to retry later if the account cannot post | Not handled before posting | creator_info errors (e.g. posting cap) show "cannot post right now, try again later" and the Post button stays off |
| 1c | Video no longer than max_video_post_duration_sec | Checked only by the server at publish | Checked on the screen too; the server still refuses |
| 2a | Title entered or edited by the user; preset text editable | Photo title was the caption's first line, not editable | Editable title (photos, up to 90 characters) and editable caption on the screen; the server uses the edited title |
| 2b | Privacy from privacy_level_options, chosen by hand, **no default** | Server defaulted to PUBLIC_TO_EVERYONE | Dropdown starts on "Choose who can see this post"; Post is disabled until chosen; after the audit the server refuses a post without a chosen privacy |
| 2c | Comment, Duet, Stitch: none on by default; greyed out when the account disables them; photos: comments only | Server took the account's settings (on by default); nothing shown | Three unticked boxes (one for photos); disabled boxes say "turned off in this account's TikTok settings"; the server sends exactly what was ticked |
| 3a | Commercial content toggle, off by default; Your brand / Branded content; label prompt | Server always sent brand_organic_toggle true; nothing shown | "Disclose post content" toggle (off), both options with TikTok's descriptions, the "Promotional content" / "Paid partnership" prompt; on with neither ticked blocks Post |
| 3b | Branded content cannot be private | Not handled | "Only me" is greyed out while Branded content is ticked (and Branded content is greyed out while Only me is chosen), with "Visibility for branded content can't be private" |
| 4 | Consent declaration with links | Missing | "By posting, you agree to TikTok's Music Usage Confirmation" (plus "Branded Content Policy" when ticked), linked, next to the Post button; recorded on the post |
| 5a | Preview of the content | Not in this flow | Slides (photos) or the video on the screen |
| 5b | No promotional watermark added by the client | Studio adds none (the slides are our own designs) | Stated on the screen |
| 5c | Send only after the user expressly consents | Launch confirmation existed | Post opens one confirmation listing account, privacy, interactions, disclosure, caption and the declaration; nothing is sent before Post |
| 5d | Tell the user processing can take a few minutes | Missing | Shown after Post and in the post's Details while it publishes |
| 5e | Poll the status API | Already done (worker polls publish/status/fetch) | Unchanged |

Server enforcement (maana `supabase/functions/_shared/platforms/tiktok.ts` `directPostInfo`, `_shared/preflight.ts`
`tiktokUxErrors`): before the audit nothing changes (direct posts are SELF_ONLY; a post saved without choices keeps
the earlier settings). After `TIKTOK_AUDITED=true`, a direct post without the creator's choices is refused.

## Before recording the demo (owner, one time)

1. Deploy the functions with these changes (maana `learn-redesign-mockups`, commits b0193e7 and 53f0b9b):
   `cd "/Volumes/The Wall/Coding/maana" && supabase functions deploy studio-api studio-worker --project-ref vymyqrxvpzlhzpvsuhya --no-verify-jwt`
2. In the TikTok developer portal, Sandbox: add the scope `video.publish` (Content Posting API, Direct Post on),
   and add the brand's TikTok account as a target user. Set that TikTok account to **private** while unaudited
   (TikTok requires it for unaudited direct posts).
3. `supabase secrets set TIKTOK_DIRECT_POST=true --project-ref vymyqrxvpzlhzpvsuhya` (Maana only is enough for the
   demo). Do **not** set `TIKTOK_AUDITED`.
4. In Studio > Connections, reconnect TikTok so the token carries `video.publish`.
5. Record with the sandbox app, as `demo-video-script.md` describes.

## What to submit, and where

All at developers.tiktok.com > Manage apps > the Studio app. Fields and suggested text:

**App details**

- App name: the app's own name (for example "Maana Studio"); TikTok rejects names that reference social media
  companies.
- Icon: the Maana mark (`/apple-touch-icon.png`, 1024 px source in the maana repo `design/logo/final`).
- Category: Business / Productivity (whatever the portal offers closest to "content management").
- Platform: Web. Website: `https://getmaana.com`. Terms: `https://getmaana.com/terms/`. Privacy:
  `https://getmaana.com/privacy/`. Redirect URI (Login Kit):
  `https://vymyqrxvpzlhzpvsuhya.supabase.co/functions/v1/studio-api/oauth/tiktok/callback`.
- Description (paste):

  > Maana Studio is the publishing workspace of Maana, an app that teaches the most common words of the Qur'an.
  > Our small team creates original short videos and photo carousels for our own brands (Maana and our sister app
  > Mawadda) and uses Studio to review each post, check it against our brand rules, and publish it to our own
  > TikTok accounts. Studio signs in with TikTok, shows which account will receive the post, lets the person
  > choose privacy, interactions and commercial disclosure on every post, shows a preview, and publishes only
  > after they confirm. It does not post for other creators and does not copy content from other platforms.

**Products and scopes** (one explanation each):

- Login Kit, `user.info.basic`: to show which TikTok account is connected (name and avatar) in Studio.
- Content Posting API, `video.upload`: to send a video or photo post to the account's TikTok inbox as a draft,
  which the account owner finishes in the TikTok app.
- Content Posting API, `video.publish` (Direct Post): to publish our own original video or photo post to our own
  account after the person chooses privacy, interactions and disclosure on Studio's TikTok screen and confirms.
- Display API, `video.list`: to read view, like, comment and share counts of our own posted videos for our
  performance reports.

**How content is created** (paste where the form asks about content source):

> Every post is original content made by our team for our own brand: carousels drafted in our content tool, checked
> by our editorial and religious-accuracy reviewers, rendered as images, and short videos we produce. Nothing is
> taken from other platforms or other creators. Studio adds no watermark.

**Posting flow** (paste, and attach the screenshots in `screenshots/`):

1. The team member signs in to Studio (getmaana.com/studio, team only) and connects the brand's TikTok account
   (TikTok Login, the scopes above).
2. A post arrives in Studio as a draft (from our content tool or a video from our library). It passes our
   pre-flight checks (caption length, brand rules, file format).
3. The person opens the draft and chooses Direct post. Studio calls creator_info and shows the account nickname
   (screenshot 1), a preview of the slides or video, and the editable title and caption.
4. They choose who can see the post from the account's own options; nothing is preselected (screenshot 2).
5. They tick the interactions they want (none are ticked; any the account disables are greyed out).
6. If the post promotes something, they turn on the disclosure and pick Your brand and/or Branded content; Studio
   shows the label TikTok will apply, and "Only me" is unavailable with branded content (screenshot 3).
7. The consent declaration with links sits next to the Post button. Post opens a final confirmation listing
   everything that will be sent (screenshot 4). Nothing reaches TikTok before they confirm.
8. Studio sends the post (Direct Post), polls the status API, and tells the person it may take a few minutes to
   appear (screenshot 5). Before the audit, every post is private (screenshot 6).

**Data use and privacy** (paste):

> Studio stores the connected account's TikTok open_id, display name and avatar URL, and the access and refresh
> tokens, encrypted in our database vault and used only by our server to publish our own posts and read their
> statistics. Tokens never reach the browser. Statistics for our own videos (views, likes, comments, shares) are
> stored to compare our posts. We do not collect data about other TikTok users, do not sell or share any data,
> and access is limited to our team members. Disconnecting the account in Studio deletes its tokens; revoking
> access in TikTok stops all use. Privacy policy: https://getmaana.com/privacy/

**Demo video**: record it from `demo-video-script.md` (MP4, under 50 MB, up to 5 files; the URL bar must show
getmaana.com, and the sandbox app must be used).

**Submit**: App review (Submit for review) for the app with the products and scopes above. When the app is
approved, apply for the Content Posting API audit (Direct Post) from the Content Posting API product page
(developers.tiktok.com/application/content-posting-api), attaching the same video, screenshots and texts.

## After approval

`supabase secrets set TIKTOK_AUDITED=true --project-ref vymyqrxvpzlhzpvsuhya` (and `MAWADDA_TIKTOK_AUDITED=true`,
plus `MAWADDA_TIKTOK_DIRECT_POST=true` when Mawadda should post directly too). From then on a direct post needs the
choices made on the TikTok screen; the "Only me" restriction lifts.

## Screenshots (dev mock, mock data)

| File | Shows |
|---|---|
| `screenshots/1-creator-and-preview.png` | Account nickname, preview, editable title and caption, empty privacy, nothing ticked |
| `screenshots/2-choices-made.png` | Privacy chosen, comments on, Your brand with the "Promotional content" label |
| `screenshots/3-branded-content-not-private.png` | Branded content: "Paid partnership", the Branded Content Policy link, "Only me" unavailable |
| `screenshots/4-consent-confirmation.png` | The final confirmation with the declaration |
| `screenshots/5-processing-notice.png` | Queued, with the processing notice |
| `screenshots/6-before-audit-only-me.png` | Before the audit: Only me is the one choice |
| `screenshots/7-video-direct-post.png` | The same screen for a video in Launch (Stitch greyed out by the account) |
