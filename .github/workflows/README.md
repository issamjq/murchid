# Add empty commit — portable setup

A manual GitHub Actions workflow that pushes an **empty commit** to a branch, so a
git-connected host (Vercel, Netlify, Render…) redeploys without a code change.
Use it for the redeploy that has no code behind it: a changed env var, a rebuilt
cache, a build that failed on a flake.

Drop-in: nothing in the file names a repo, an account, or a project.

---

## Install

1. Copy `empty-commit.yml` to `.github/workflows/empty-commit.yml` and commit it
   to the **default branch**. GitHub only offers a manual run for workflows that
   exist there.
2. **Settings → Actions → General → Workflow permissions → Read and write.**
   Without it the push step fails with a 403.
3. Run it: **Actions → "Add empty commit" → Run workflow**, or

   ```sh
   gh workflow run empty-commit.yml
   ```

---

## The commit author — the part that decides whether the deploy works

Vercel rejects a deploy when the git author is not a member of the project:

> Git author X must have access to the project

So the author has to be an account with access. The workflow resolves it as
**first non-empty wins**:

| # | Source | When it applies |
|---|--------|-----------------|
| 1 | the `author` input | you typed one at run time |
| 2 | repo variable `DEPLOY_COMMIT_AUTHOR` | set once per repo |
| 3 | whoever clicked **Run workflow** | the default — zero configuration |

`format('{0} <{1}+{0}@users.noreply.github.com>', github.actor, github.actor_id)`

**Option 3 is right for most repos.** The person running it already has access,
so the commit is authored by them and the deploy passes.

Set option 2 only where the **deploying account differs from the people running
the workflow** — e.g. a bot account owns the host project while humans push:

```sh
gh variable set DEPLOY_COMMIT_AUTHOR \
  --body 'mkmjq <270577639+mkmjq@users.noreply.github.com>'
```

To find someone's numeric id:

```sh
gh api users/<login> --jq '"\(.login) <\(.id)+\(.login)@users.noreply.github.com>"'
```

The `<id>+<login>@users.noreply.github.com` form has to be **exact**. Get it
wrong and GitHub renders an unlinked plain name on the commit, and the host's
membership check fails.

---

## Gotchas

- **Protected branch.** `GITHUB_TOKEN` cannot push to a branch with protection
  rules. Create a fine-grained PAT with **Contents: write**, store it as a
  secret, and swap the single `token:` line in the checkout step:

  ```yaml
  token: ${{ secrets.DEPLOY_PAT }}
  ```

  That is the only place the token appears — checkout persists it in the remote
  URL, so the push step needs no change.

- **Vercel "Ignored Build Step".** If the project has one configured (a
  `git diff` check, a Turborepo filter, `vercel.json` → `ignoreCommand`), it will
  skip the build outright — an empty commit changes no files, which is exactly
  what those checks look for. Either remove the ignore step or make it let
  `chore: trigger deploy` through.

- **No loop.** Pushes made with `GITHUB_TOKEN` do not re-trigger GitHub Actions,
  so this workflow can never trigger itself. The host's GitHub App still sees the
  push webhook.

- **No schedule, deliberately.** A daily empty commit is a commit a day of noise
  in `git log` for a deploy nobody asked for, and it redeploys whatever happens
  to be on the branch at that moment. If you genuinely want one, add a
  `schedule:` block under `on:` and push it to the default branch (GitHub reads
  schedules from there only). The `|| 'default'` fallbacks throughout are already
  in place for that case — on a schedule run the `inputs` context is empty, so
  the input defaults do not apply.

---

## Design notes carried over from the version running in production

- **Author *and* committer are both set.** Setting only `--author` leaves the bot
  as committer, and GitHub renders "X authored and github-actions[bot]
  committed".
- **Inputs pass through `env:`**, never interpolated into `run:`. An input
  carrying a quote or `$( )` would otherwise be executed by the shell.
- **`concurrency:` group** per branch, `cancel-in-progress: false` — two runs
  pushing to the same branch race, and the loser fails on a non-fast-forward.
  Queue them instead.
- **Author format is validated** before use, with a clear `::error::` rather than
  a confusing git failure.
