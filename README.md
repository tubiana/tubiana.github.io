# tubiana.github.io

Personal academic site, built with Jekyll. Structure is inspired by
[al-folio](https://github.com/alshedivat/al-folio), customized from scratch
(not a fork). Deployed automatically to GitHub Pages via GitHub Actions on
every push to `main` (see `.github/workflows/deploy.yml`).

**Everything below is a content edit — Markdown, YAML or BibTeX. You never
need to touch HTML, Sass or JavaScript for routine updates.**

## One-time setup (only needed once)

In the repo's GitHub settings → **Pages**, set **Source** to **GitHub
Actions** (not "Deploy from a branch"). After that, every push to `main`
rebuilds and redeploys the site automatically — nothing else to configure.

## Add a publication

Open [`_bibliography/publications.bib`](_bibliography/publications.bib) and
copy an existing `@article{...}` block, then edit it. The Publications page
regenerates itself from this file — nothing else to touch. Useful optional
fields (add/remove freely):

```bibtex
doi   = {10.xxxx/xxxxx}          % makes the title a clickable link
code  = {https://github.com/...} % adds a "Code" link
role  = {first-author,review}    % shows badges (see the comment at the
                                  % top of the file for the full list)
```

A `journal`/`booktitle` containing "bioRxiv" is auto-tagged **Preprint**.

## Add a project

Edit [`_data/projects.yml`](_data/projects.yml) — copy the commented example
block at the top into the list and fill it in. The Projects page switches
from its "coming soon" placeholder to your project list automatically once
the file isn't empty.

## Add a tool

Edit [`_data/tools.yml`](_data/tools.yml). Add an entry under the right
category (or make a new category block), following the pattern of the
existing entries. `type: webapp` shows an "Open app" button (for a demo
hosted on this same domain); `type: repo` just links to GitHub.

## Add a course

Edit [`_data/courses.yml`](_data/courses.yml) — copy a block and fill it in.
Newest first.

## Add a supervised student

Edit [`_data/students.yml`](_data/students.yml). By design, only the
**level** (PhD, Master 1, etc.) and institution are shown — no names — so
students aren't identifiable here without asking them first.

## Add a gallery photo or video

Edit [`_data/gallery.yml`](_data/gallery.yml) — see the comment at the top
of the file. Drop the image in `assets/images/gallery/`. For a video, upload
it to YouTube and set `youtube_id` (preferred — no large video files to
serve); until then, `video_src` plays a local file from `assets/videos/`
instead.

## Edit the CV

Everything on the [`/cv/`](cv.html) page comes from the small YAML files in
[`_data/cv/`](_data/cv/): `experience.yml`, `education.yml`, `grants.yml`,
`awards.yml`, `service.yml`, `focus_areas.yml`. Edit whichever one you need.

## Edit your bio, links, or the homepage text

- Contact info, ORCID, Google Scholar and GitHub links: top of
  [`_config.yml`](_config.yml), under `social:` and `affiliation:`.
- Funding logos on the homepage: [`_data/funding.yml`](_data/funding.yml).
- Homepage intro text and hero: [`index.html`](index.html) (front matter +
  the first `<p class="hero-lead">`).
- Research page narrative: [`research.html`](research.html).

## Test locally before pushing

You'll need Ruby (e.g. via [RubyInstaller](https://rubyinstaller.org/) on
Windows) installed once:

```bash
bundle install
bundle exec jekyll serve
```

Then open `http://localhost:4000`. `bundle exec jekyll serve --livereload`
auto-refreshes the browser on save.

