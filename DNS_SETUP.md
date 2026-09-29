# getmaana.com DNS setup (Porkbun → GitHub Pages)

The site is served by GitHub Pages from `sytalhas/getmaana-site` (main branch, root).
The `CNAME` file and the Pages custom-domain setting are both `getmaana.com`, so the
site goes live as soon as these records exist.

## 1. Remove Porkbun's parking records

Porkbun → Account → Domain Management → getmaana.com → **DNS**.
Delete the default records Porkbun created:

- the `ALIAS` record on `getmaana.com` pointing to `pixie.porkbun.com`
- the `CNAME` record `*.getmaana.com` (wildcard) pointing to `pixie.porkbun.com`
- any `A`/`CNAME` on `www` that points to Porkbun parking

Do **not** delete MX or TXT records that Porkbun Email Forwarding adds (see step 4).

## 2. Add the GitHub Pages records

| Type  | Host (leave blank = apex) | Answer                | TTL |
|-------|---------------------------|-----------------------|-----|
| A     | *(blank)*                 | 185.199.108.153       | 600 |
| A     | *(blank)*                 | 185.199.109.153       | 600 |
| A     | *(blank)*                 | 185.199.110.153       | 600 |
| A     | *(blank)*                 | 185.199.111.153       | 600 |
| AAAA  | *(blank)*                 | 2606:50c0:8000::153   | 600 |
| AAAA  | *(blank)*                 | 2606:50c0:8001::153   | 600 |
| AAAA  | *(blank)*                 | 2606:50c0:8002::153   | 600 |
| AAAA  | *(blank)*                 | 2606:50c0:8003::153   | 600 |
| CNAME | www                       | sytalhas.github.io    | 600 |

The AAAA records are optional (IPv6) but recommended.
`www.getmaana.com` will redirect to `getmaana.com` automatically.

## 3. Verify, then enforce HTTPS

From a terminal (allow 5–60 minutes for propagation):

```sh
dig +short getmaana.com A        # the four 185.199.10x.153 addresses
dig +short www.getmaana.com      # sytalhas.github.io. then the same IPs
curl -sI http://getmaana.com | head -1
```

Then open GitHub → `sytalhas/getmaana-site` → Settings → **Pages**. When the
page shows "Your site is live at https://getmaana.com" and the DNS check is
green, GitHub issues a Let's Encrypt certificate (usually within an hour; up to
24 h). As soon as the **Enforce HTTPS** checkbox becomes clickable, tick it.
If it stays greyed out for over a day, remove and re-add `getmaana.com` in the
Custom domain box to retrigger the certificate.

Or from the CLI once the certificate exists:

```sh
gh api -X PUT repos/sytalhas/getmaana-site/pages -F https_enforced=true
```

Optional hardening: GitHub → Settings (your account) → Pages → **Add a verified
domain** `getmaana.com`; it asks for a TXT record `_github-pages-challenge-sytalhas`.
Add it at Porkbun. This stops anyone else claiming the domain on GitHub Pages.

## 4. support@getmaana.com (Porkbun Email Forwarding)

Email forwarding is separate from the website records above.

1. Porkbun → getmaana.com → **Email Forwarding** (the "Email" icon on the domain row).
2. Add a forward: `support` → the owner's real inbox.
3. Porkbun adds its own `MX` records (`fwd1.porkbun.com`, `fwd2.porkbun.com`) and an
   SPF `TXT` record on the apex. Keep them.

These don't conflict with GitHub Pages: A/AAAA/CNAME serve the website, MX/TXT
route email. The one rule is **never add a CNAME on the apex** (`getmaana.com`
itself); it would override the MX records and break email. Use the A/AAAA
records above for the apex, and a CNAME only on `www`.

Test by sending an email to support@getmaana.com from another account.
