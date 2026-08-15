# Preview Deployments

Every branch pushed to this repository is built and published to a
[Cloudflare Worker][workers], so changes can be reviewed in a real browser
before they are merged. When a branch has an open pull request, a bot comment on
that pull request links to its preview and is kept up to date on every push.

Production is **not** affected: `systems.seas.harvard.edu` continues to build
and deploy from `master` to GitHub Pages via
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

## Preview URLs

| Branch | URL |
| --- | --- |
| `master` | `https://harvardsys-preview.<subdomain>.workers.dev` |
| any other branch | `https://<branch-alias>-harvardsys-preview.<subdomain>.workers.dev` |

`<subdomain>` is your account's `workers.dev` subdomain, and `<branch-alias>` is
the branch name lowercased with everything that is not a letter or digit turned
into a dash. Cloudflare requires the alias to start with a letter and the whole
`<alias>-harvardsys-preview` label to fit in 63 characters, so a leading digit
gets a `b-` prefix and long branch names are shortened and given a short digest
to keep them unique:

| Branch | Alias |
| --- | --- |
| `feature/add-Emma-Seminar` | `feature-add-emma-seminar` |
| `123-numeric-start` | `b-123-numeric-start` |
| `a-very-long-branch-name-that-exceeds-the-limit` | `a-very-long-branch-na-0fb18f` |

Because the alias is derived from the branch name, a branch keeps the same
preview URL for its whole life — pushing again replaces the content in place.

## One-time setup

The workflow is inert until two repository secrets exist. Until then it logs a
warning and exits successfully, so it never blocks a pull request.

### 1. Create a Cloudflare API token

In the Cloudflare dashboard, go to **My Profile → API Tokens → Create Token**
and use the **Edit Cloudflare Workers** template. It grants the
`Workers Scripts: Edit` permission that publishing needs. Scope it to the
account that should host the previews and copy the generated token.

### 2. Find your account ID

Open **Workers & Pages** in the dashboard; the **Account ID** is shown in the
right-hand sidebar. It is also printed by `npx wrangler whoami`.

### 3. Add the secrets to GitHub

In this repository, go to **Settings → Secrets and variables → Actions → New
repository secret** and add both:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | the account ID from step 2 |

That is all. The next push to any branch creates the Worker automatically — the
first run does a plain `wrangler deploy`, because `wrangler versions upload`
cannot create a Worker that does not exist yet, and every run after that
publishes a preview version.

## How a preview differs from production

Previews are built to match what merging to `master` will publish, with two
deliberate exceptions:

- **Analytics are disabled.** The build runs with `HUGO_ENVIRONMENT=preview`
  rather than `production`. The theme gates Google Analytics and Statcounter
  behind `hugo.IsProduction`, so preview traffic never reaches the site's
  analytics. Nothing visible on the page changes.
- **Search engines are blocked.** Each preview is served with
  `X-Robots-Tag: noindex, nofollow` plus a disallow-all `robots.txt`, so preview
  copies cannot compete with `systems.seas.harvard.edu` in search results.

Everything else matches production, including the Hugo version (pinned to the
same value as the production workflow) and the exclusion of drafts. A post with
`draft = true` will **not** appear in its preview — set `draft = false` before
opening the pull request, as described in the [new post guide](new-post.md).

The site is built with `--baseURL "/"` so that all links and assets are
root-relative, which lets the same output work on any preview hostname.

## Pull requests from forks

GitHub does not expose repository secrets to workflows triggered by a pull
request from a fork, so those pull requests do not get a preview. Branches
pushed directly to this repository — the normal workflow here — always do.

## Local preview

You do not need Cloudflare to preview your work locally:

```bash
hugo server
```

To check the exact output that gets published to a preview:

```bash
HUGO_ENVIRONMENT=preview hugo --gc --minify --baseURL "/"
npx wrangler dev
```

## Troubleshooting

**The workflow says "Preview skipped".**
The two secrets above are missing or empty. Add them and re-run the workflow.

**No comment appeared on my pull request.**
The comment is only posted for pull requests opened from a branch in this
repository. Check the workflow run's summary — the preview URL is always
recorded there, even when no comment is posted.

**The preview 404s on a page that works locally.**
Confirm the page is not a draft. Unknown paths are served Hugo's `404.html`.

## Alternative: Cloudflare Workers Builds

The [`wrangler.jsonc`](../wrangler.jsonc) in this repository also works with
[Workers Builds][builds], Cloudflare's built-in Git integration, if you would
rather have Cloudflare do the building instead of GitHub Actions. Connect the
repository in the dashboard and set:

- **Build command:** `hugo --gc --minify --baseURL "/"`
- **Deploy command:** `npx wrangler deploy`
- **Non-production branch builds:** enabled, so all branches are built
- **Build variables:** `HUGO_VERSION = 0.164.0` (the image default is older) and
  `HUGO_ENVIRONMENT = preview`

Note that Workers Builds needs the `themes/paper` submodule to be fetched, and
that running both it and the GitHub Actions workflow would publish the same
Worker twice. Pick one.

[workers]: https://developers.cloudflare.com/workers/
[builds]: https://developers.cloudflare.com/workers/ci-cd/builds/
