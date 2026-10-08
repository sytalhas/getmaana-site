#!/usr/bin/env python3
"""Build getmaana.com from site.json + _src/.

    pip install markdown
    python3 build.py

Writes index.html, privacy/, terms/, support/, delete-account/, 404.html
and sitemap.xml into the repo root (GitHub Pages serves main:/).

Legal values live in site.json. A null value never prints a placeholder:
effective_date null -> "Effective date: pending"; postal_address null -> the
line is dropped. The build fails if any bracketed draft text or unfilled
{{variable}} reaches the output.
"""
import datetime
import html
import json
import os
import re
import sys

import markdown

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "_src")
S = json.load(open(os.path.join(ROOT, "site.json"), encoding="utf-8"))

# Google Play badge only when a live listing exists (Google's badge rules
# forbid linking a badge to nowhere). Until then, say Android is coming.
if S.get("play_store_url"):
    S["play_badge"] = ('<a class="store-badge store-badge--play" href="' + S["play_store_url"] + '">'
                       '<img src="/assets/google-play-badge.png" alt="Get it on Google Play" width="203" height="60"></a>')
else:
    S["play_badge"] = '<p class="fine soon">Android: coming soon</p>'
E = html.escape

PAGES = [  # path, title, description, sitemap priority
    ("/", None, None, "1.0"),
    ("/privacy/", "Privacy Policy", "How Maana handles your information.", "0.5"),
    ("/terms/", "Terms of Use", "The terms for using Maana.", "0.5"),
    ("/support/", "Support", "Help with Maana: Supporter plans and tips, restoring purchases, reporting a word and deleting your account.", "0.7"),
    ("/delete-account/", "Delete your account", "How to delete your Maana account and data.", "0.4"),
]


def fill(text, values):
    def sub(m):
        key = m.group(1)
        if key not in values:
            sys.exit(f"build: unknown template variable {{{{{key}}}}}")
        return str(values[key])
    return re.sub(r"\{\{\s*([a-z_]+)\s*\}\}", sub, text)


def legal_values():
    email = S["support_email"]
    contact = [S["publisher"]]
    if S.get("postal_address"):
        contact += [line for line in S["postal_address"].split("\n")]
    contact.append(f"[{email}](mailto:{email})")
    fonts = ("- **Fonts.** Some fonts are downloaded from Google Fonts "
             "(fonts.gstatic.com) the first time they are needed. Google "
             "receives your IP address as part of that request."
             if S.get("fonts_fetched_at_runtime") else "")
    rr = S.get("regional_rights")
    atts = S.get("attributions") or []
    att_md = ""
    if atts:
        att_md = " They include:\n" + "\n".join(f"    - {a}" for a in atts)
    if S.get("jurisdiction"):
        law = (f"These terms are governed by {S['jurisdiction']}, without regard "
               f"to conflict-of-law rules.")
        if S.get("courts"):
            law += (f" Any dispute arising from these terms or the app is subject "
                    f"to the jurisdiction of {S['courts']}.")
    else:
        law = "Governing law: pending."
    age = S.get("min_age")
    return {
        "publisher": S["publisher"],
        "support_email": email,
        "apple_eula_url": S["apple_eula_url"],
        "contact_block": "  \n".join(contact),
        "fonts_bullet": fonts,
        "report_retention": S.get("report_retention") or "",
        "regional_rights": (" " + rr) if rr else "",
        "attributions": att_md,
        "governing_law": law,
        "children": (f"Maana is not directed at children under {age}."
                     if age else "Maana is not directed at young children."),
    }


def render_legal(name):
    md = fill(open(os.path.join(SRC, name + ".md"), encoding="utf-8").read(), legal_values())
    body = markdown.markdown(md, extensions=["sane_lists"])
    # external links open normally but are marked
    body = body.replace('<a href="http', '<a rel="noopener" href="http')
    date = S.get("effective_date")
    stamp = (f"Last updated: {E(date)}" if date
             else "Effective date: pending")
    return stamp, body


def layout(path, title, desc, main, body_class=""):
    full = f"{title} · {S['app_name']}" if title else f"{S['app_title']}"
    desc = desc or f"{S['subtitle']}. {S['promise']}"
    url = S["site_url"] + path
    og = S["site_url"] + "/assets/og-image.jpg"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(full)}</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="#F8F3EA">
<meta name="apple-itunes-app" content="app-id=6817107338">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{E(S['app_name'])}">
<meta property="og:title" content="{E(full)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Al-Fātiḥah with the words you know highlighted in green">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Nunito:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body class="{body_class}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/"><img src="/assets/icon-192.png" alt="" width="36" height="36"><span>{E(S['app_name'])}</span></a>
    <nav aria-label="Site"><a href="/support/">Support</a><a class="store-badge store-badge--header" href="{S['app_store_url']}"><img src="/assets/app-store-badge.svg" alt="Download on the App Store" width="120" height="40"></a></nav>
  </div>
</header>
<main id="main">
{main}
</main>
<footer class="site-footer">
  <div class="wrap">
    <nav aria-label="Footer">
      <a href="/privacy/">Privacy</a>
      <a href="/terms/">Terms</a>
      <a href="/support/">Support</a>
      <a href="/delete-account/">Delete account</a>
    </nav>
    <p>© {datetime.date.today().year} {E(S['publisher'])} · <a href="mailto:{S['support_email']}">{S['support_email']}</a></p>
  </div>
</footer>
</body>
</html>
"""


def page(src, **extra):
    vals = {k: v for k, v in S.items() if isinstance(v, (str, int))}
    vals.update(extra)
    return fill(open(os.path.join(SRC, src), encoding="utf-8").read(), vals)


def write(rel, text):
    out = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(text)
    return out


BAD = [
    re.compile(r"\[[^\]\n]{1,120}\]"),  # any bracketed text: [DATE], [13 / 16], [LEGAL REVIEW: ...]
    re.compile(r"\{\{"),
    re.compile(r"LEGAL REVIEW|CONFIRM|DRAFT|POSTAL ADDRESS|RETENTION PERIOD|JURISDICTION"),
]


def check(path, text):
    visible = re.sub(r"<[^>]+>", " ", text)
    for rx in BAD:
        m = rx.search(visible)
        if m:
            sys.exit(f"build: placeholder text in {path}: {m.group(0)!r}")


def main():
    outputs = {}
    outputs["index.html"] = layout("/", None, None, page("index.html"), "home")
    for slug, (title) in (("privacy", "Privacy Policy"), ("terms", "Terms of Use")):
        stamp, body = render_legal(slug)
        main_html = (f'<article class="wrap prose legal">\n<h1>{title}</h1>\n'
                     f'<p class="stamp">{stamp}</p>\n{body}\n</article>')
        desc = dict((p[0], p[2]) for p in PAGES)[f"/{slug}/"]
        outputs[f"{slug}/index.html"] = layout(f"/{slug}/", title, desc, main_html)
    outputs["support/index.html"] = layout("/support/", "Support", PAGES[3][2], page("support.html"))
    outputs["delete-account/index.html"] = layout("/delete-account/", "Delete your account", PAGES[4][2], page("delete-account.html"))
    outputs["404.html"] = layout("/404.html", "Page not found", "This page does not exist.", page("404.html"))

    for rel, text in outputs.items():
        check(rel, text)
        write(rel, text)
        print("wrote", rel)

    today = datetime.date.today().isoformat()
    sm = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for path, _, _, pri in PAGES:
        sm.append(f"  <url><loc>{S['site_url']}{path}</loc><lastmod>{today}</lastmod><priority>{pri}</priority></url>")
    sm.append("</urlset>\n")
    write("sitemap.xml", "\n".join(sm))
    write("robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {S['site_url']}/sitemap.xml\n")
    write("CNAME", "getmaana.com\n")
    print("wrote sitemap.xml robots.txt CNAME")

    pending = [k for k in ("effective_date", "jurisdiction") if not S.get(k)]
    if not S.get("postal_address"):
        print("note: postal_address is null (line omitted)")
    if pending:
        print("PENDING legal values:", ", ".join(pending))


if __name__ == "__main__":
    main()
