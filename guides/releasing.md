# Releasing

The narration behind AGENTS.md "Releasing": what each job of the publish workflow does and the invariant it keeps, the
release-day checklist for npm and the `release` environment, the release steps with what each one checks, the tag
step's failure cases, the MCP Registry record and the lessons. AGENTS.md keeps the steps in short form and stays the
canonical guide; where the two disagree, AGENTS.md wins. Read this file before a release and before changing
`.github/workflows/publish.yml`. Most of it was moved here from AGENTS.md; sentences about the publisher's two days, a publish that fails part
way, the re-run limits and the manual Registry path were corrected against the workflow afterwards.

The `.mcpb` bundle is retired (0.13.0): nothing builds or publishes one, and `scripts/check-pack.mjs` refuses a
`.mcpb` inside a package. Adding or changing an MCP tool is in AGENTS.md "Releasing".

Releases ship via `.github/workflows/publish.yml` on a `v*` tag, using npm **trusted
publishing** (OIDC) — **no `NPM_TOKEN`**. A trusted publisher is configured on npm for all
three packages (`@claudinho/core` · `cli` · `mcp`), all published **with provenance**.

The workflow has four jobs, so the npm credential never shares a job with the repository's code or
its dependencies. `build` (`contents: read`) checks the commit and the tag, installs, builds,
typechecks, tests, lints, packs the three tarballs (`pnpm pack`, which rewrites `workspace:` ranges)
and uploads them with `packages/mcp/server.json` as one artifact, their sha256 in its summary and its
output. `publish` (`id-token: write`, in the GitHub environment `release`) checks out nothing and
installs nothing: it downloads the artifact, refuses any file `build`'s sums do not list or do not
match, passes each tarball through a shape filter (the layout `pnpm pack` writes and nothing else),
reads its manifest with the same call `npm publish` makes, from the pacote inside the npm that
publishes (so what it checks is what npm reads), refuses a manifest that is not the tag's package
and version with `publishConfig` exactly `{"access":"public"}`, and runs `npm publish <tarball>
--provenance --ignore-scripts` with the registry, global and scoped, on the command line, from an
empty directory of its own, for core, then cli, then mcp
(Node 24: trusted publishing needs npm 11.5.1 or later, newer than Node 22's). `release`
(`contents: write`) creates the GitHub Release. `mcp-registry` (`id-token: write`, outside the
environment) publishes `server.json` from the artifact. The invariant of the two jobs that hold the
credential: nothing `build` produced can change where they authenticate or publish, or run code in
them; it can only be the bytes that are published.

**Release-day checklist for npm and the `release` environment** (the maintainer's steps; numbered
"checklist step N" to keep them apart from the release steps below):

1. Once, and BEFORE checklist step 2: GitHub, repository Settings → Environments → `release` (New environment the first time;
   the existing one if a run already created it). Under "Deployment branches and tags", choose
   "Selected branches and tags" and add the tag rule `v*` (no branch). Under "Required reviewers",
   add yourself; leave "Prevent self-review" off (you push the tag, so with it on nobody could
   approve). Save the rules.
2. For each of `@claudinho/core`, `@claudinho/cli` and `@claudinho/mcp`, no more than 2 days before
   that package's first successful publish through the new publisher: npmjs.com, the package's Settings → Trusted publishing. Delete the publisher that names
   no environment, then add a GitHub Actions publisher: owner `arturogarrido`, repository
   `claudinho`, workflow `publish.yml`, environment `release`, and under "Allowed actions" tick
   direct `npm publish` (a publisher created after Sep 3, 2026 allows `npm stage publish` alone
   unless you do). npm's documentation: "A newly created trusted publisher configuration must
   complete its first successful publish within 2 days." A publisher not used within 2 days
   expires ("it expires and can no longer be used or edited"): delete it and add it again. A publisher
   is a package's own, and only a successful `npm publish` of THAT package through it validates it:
   - before the tag: add it again, then tag;
   - the tag pushed and `publish` still waiting for your approval: add it again BEFORE you approve;
   - a run that failed on authentication: add it again only for a package whose version is NOT yet on
     npm, then re-run. Ask npm itself, with the registry the workflow publishes to and not whatever
     this machine's npm configuration points at: `npm view <name>@<version> version --registry https://registry.npmjs.org/ "--@claudinho:registry=https://registry.npmjs.org/"`
     prints the version when npm serves it; an error is no answer either way. The re-run skips a package npm already serves, so THIS re-run does not
     validate a publisher recreated for such a package, and it expires unless another publish of that
     package goes through it inside its 2 days: leave that one as it is.
   Once a release has validated all three, this step is done; it is not repeated per release.
3. Tag the release (release step 3 below), approve the `publish` job when GitHub asks, and watch the
   four jobs.

With the environment-less publisher gone there is no fallback for trusted publishing: of this
repository's jobs, only one in the `release` environment can publish that way. (npm's other ways to
publish, a maintainer's own login or a token where the package's settings allow one, are npm's
settings, not this workflow's.) The job publishes the three packages one at a time (core, then cli, then
mcp) with no rollback: a failure on one stops the loop, so this run did not attempt the
packages after it. The failure does not say what is on npm: what this run published before it stays
there, the failing package itself may have been accepted (a response lost after npm took it), and an
earlier attempt of the same tag may have published any of them. `npm view` against the public registry (the command in checklist step 2) says what is on npm. A re-run skips a package only when
its own `npm view <name>@<version> version`, asked of that registry, prints that version. For a version that IS on npm but that the
lookup did not print (an error; npm not yet serving a version published moments ago), the job tries
to publish it, npm refuses the duplicate and the job stops there: re-run it once npm serves the
version. This is what "skips a version npm already has" means wherever this guide
says it. A `publish` job refused on authentication
is fixed on npm (the publisher's owner, repository, workflow file, environment, or its allowed
action), then "Re-run failed jobs"; recreating a publisher takes a few minutes.

Checklist step 1 comes first. If a tag is pushed before its rules are saved, GitHub's documentation
says "Running a workflow that references an environment that does not exist will create an
environment with the referenced name", so the `publish` job runs in an unprotected `release` and
nothing asks for approval:

- With checklist step 2 already done, the publisher that names `release` accepts that run, and it
  publishes on its first try without anyone's approval; nothing fails, so there is nothing to
  re-run. Save the environment's rules (checklist step 1) at once, before the next tag.
- With the environment-less publisher still on npm, whether npm accepts a token naming an
  environment against a publisher naming none is not documented. If it publishes, the same holds.
  If it fails on authentication, FIRST save the rules on the `release` environment GitHub created
  (checklist step 1, on the existing environment), THEN do checklist step 2, and only then "Re-run
  failed jobs": a re-run before the rules are saved runs without approval.

To cut a release:

1. Bump the version in the **three** `package.json` files (`packages/{cli,mcp,core}/package.json`).
   The cli `--version` and MCP `serverInfo.version` are injected from package.json at build time
   (tsup `define` → `process.env.CLAUDINHO_VERSION`), so there are no source constants to touch.
   **Also bump `packages/mcp/server.json`** (its `version` and its npm package pin) — the MCP
   Registry record carries its own; a vitest guard (`packages/mcp/test/server.test.ts`) fails if it drifts.
2. `pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint` (CI re-runs these). **For any
   user-facing change, also run `pnpm release:qa`** and eyeball every surface against the live feed
   before tagging (see AGENTS.md "Release readiness").
3. Commit, open the release PR and squash-merge it. Then tag the commit the merge made on `main`,
   never the release branch's own commit: the squash is a NEW commit, absent from a local clone until
   a fetch, and a bare `git tag vX.Y.Z` tags `HEAD`, which in the release worktree is the branch's
   commit. With `<n>` the release PR:

   ```bash
   git fetch origin +refs/heads/main:refs/remotes/origin/main &&
     sha=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid) &&
     git merge-base --is-ancestor "$sha" refs/remotes/origin/main &&
     git tag vX.Y.Z "$sha" && git push origin refs/tags/vX.Y.Z:refs/tags/vX.Y.Z
   ```

   The fetch names its refspec, so it refreshes `origin/main` whatever the clone's
   `remote.origin.fetch` holds (a `--single-branch` clone's does not name `main`). The push names
   both sides of its refspec, so a `remote.origin.push` mapping in the clone's config cannot send
   the tag to another name or force it there, as it can a bare `git push origin vX.Y.Z`. Each
   command runs only when the one before it succeeded. When the chain stops before `git tag` (the
   fetch or `gh` failed, the PR is not merged, or `main` does not hold its merge commit), nothing is
   tagged: check that `gh pr view <n> --json state` says `MERGED`, then run the block again. When
   `git tag` or the push fails, stop: this step never deletes or moves a tag on `origin`; read the
   tags as "When the tag step stops at `git tag` or the push" below says, and do only what its case
   says. The workflow runs on a `v*` tag push alone (it has no manual trigger). Its `build` job first
   fails on a commit `main` does not contain (a tag on the branch's commit publishes nothing), then on
   a ref that is not a `refs/tags/v*` tag whose version every package carries, then gates (build,
   typecheck, test, lint) and packs. The `publish` job then waits for the maintainer's approval (the
   `release` environment), and ships all three via OIDC with `npm publish` of each tarball (versions
   already on npm are skipped; the first failure stops it, so cli and mcp never go out without core);
   the `release` job creates the GitHub Release (`gh release create --generate-notes`); the
   `mcp-registry` job then publishes the tag's record to the official MCP Registry.
   A failed run is retried on the same tag with "Re-run failed jobs" (`gh run rerun <id> --failed`):
   a re-run job reads the artifact `build` uploaded and checks it against `build`'s sums (a check
   that fails stops the job; "Re-run all jobs" then rebuilds), the `publish` job asks for approval
   again and skips a version npm already has, the Release step skips a Release that exists, and
   `mcp-registry` skips a version the Registry has. The artifact is kept 7 days, and two jobs download it,
   `publish` and `mcp-registry` (`release` does not). After the 7 days a `publish` approved late, or a
   re-run that does not include `build`, fails at the download ("Re-run failed jobs" re-runs the failed
   jobs and the jobs that depend on them: when `release` is among them it can create the GitHub Release
   before `mcp-registry` fails there). A re-run that includes `build` rebuilds the artifact: "Re-run all
   jobs", or a re-run of the `build` job, which re-runs every job that depends on it; `publish` asks for
   approval again. GitHub's limits (its documentation, "Re-running workflows and jobs"): a run can be
   re-run "up to 30 days after its initial run" and "a maximum of 50 times". The workflow starts on a
   tag push alone and a tag on `origin` is never moved, so a release that failed past either limit is the
   maintainer's to decide, not a step to retry.
4. Once all four jobs are green, update the maintainer's own machine and read each version back. None of
   it updates by default: an npm global install never updates itself, and Claude Code leaves plugin
   auto-update off by default for a third-party marketplace such as this one.
   - The CLI: `command -v claudinho` names the copy that runs. For npm's (the usual case),
     `npm i -g @claudinho/cli@latest`; for a copy another installer put there (pnpm or Volta, for
     example), that installer's update. Then `claudinho --version` prints the new version.
   - The plugin: `claude plugin marketplace update claudinho` (refreshes the marketplace's listing only),
     then `claude plugin update claudinho@claudinho`, then `claude plugin list` shows the version in
     `packages/plugin/.claude-plugin/plugin.json` on `main`. The marketplace follows the default branch,
     not the tag: users get `main`'s plugin, which is the tag's only while `main` carries no later
     plugin bump. The plugin's version is its own, not the npm version; a session already open keeps the
     old one until `/reload-plugins` or the next session.
   - The MCP server needs nothing when it runs as `npx -y @claudinho/mcp` and no other copy is
     installed: npx asks the registry for the newest version of a bare package name at each start of
     the server. A copy in the project the server starts in (`npm ls @claudinho/mcp` there) or a global
     one (`npm ls -g @claudinho/mcp`) is used as installed instead, the project's first: update every
     copy the two list (`npm i @claudinho/mcp@latest` in that project, `npm i -g @claudinho/mcp@latest`),
     read each back with the same `npm ls`, then restart the server.

**When the tag step stops at `git tag` or the push.** A failed `git tag` does not prove a tag
exists: it can fail without making one. Read three things first, in the clone the block ran in,
with `<n>` the release PR (the `^{}` is quoted: zsh with `EXTENDED_GLOB` set reads an unquoted one
as a glob and runs nothing):

```bash
gh pr view <n> --json mergeCommit --jq .mergeCommit.oid
git ls-remote origin refs/tags/vX.Y.Z 'refs/tags/vX.Y.Z^{}'
git show-ref --verify -d refs/tags/vX.Y.Z
```

The first prints the merge commit. The second reads the tag on `origin` and the third the local
one. Only a line whose name is exactly `refs/tags/vX.Y.Z` or `refs/tags/vX.Y.Z^{}` counts:
`git ls-remote` matches a name by its end, so a branch named `refs/heads/refs/tags/vX.Y.Z` prints
too, and it is not the tag. Counted that way, both print alike: no line when there is no such tag
(the third then fails with `not a valid ref`), one line for a lightweight tag (the object it
names), and two for an annotated one, whose target is the line ending `^{}` (the other names the
tag object: this repository's annotated `v0.1.0` prints `328ad4e` for the object and `748dfd6` for
its commit). A tag is "on the merge commit" when that line names it, and "elsewhere" when it names
anything else. When `gh` or `git ls-remote` fails, nothing is decided: read again once it answers.
Then the tag on `origin` decides first:

- **`origin` has the tag on the merge commit:** the release is tagged, and the step ends here;
  nothing is pushed or run again. The publish workflow runs on that tag (release step 4 waits for its
  four jobs). A local tag elsewhere would stop a later `git tag`: `git tag -d vX.Y.Z` removes it.
- **`origin` has the tag elsewhere** (an earlier bare `git tag` was pushed): stop; the step ends
  here. Moving a pushed tag is the maintainer's decision, never an agent's: the tag is public, and
  the workflow may already have published from it (a commit on `main` passes its check).
  Deleting the local tag does not get past it. In a clone that fetches tags (git's default) and
  holds the tag's commit (the release worktree holds the release branch's head), the block's fetch
  brings the tag back and `git tag` stops; in any other clone `git tag` succeeds and the push is
  rejected because the tag already exists on `origin`. What the maintainer reads before deciding:
  the publish run on the tag (`gh run list --workflow publish.yml --branch vX.Y.Z`), whether npm has
  the version, for each of the three packages (`npm view @claudinho/core@X.Y.Z version`, and the
  same for `cli` and `mcp`: each prints the version, or fails with `E404`; the workflow publishes
  them one at a time, so one can be on npm while another is not), and the GitHub Release
  (`gh release view vX.Y.Z`).
- **`origin` has no tag, and the local tag is on the merge commit** (the push failed):
  `git push origin refs/tags/vX.Y.Z:refs/tags/vX.Y.Z`.
- **`origin` has no tag, and the local tag is elsewhere:** `git tag -d vX.Y.Z`, then run the block
  again.
- **Neither has the tag:** `git tag` failed without making one, and printed why: a signing setting
  (`tag.gpgSign`) whose signer failed or whose message was left empty, or a ref lock (`cannot lock
  ref`: another git process, or a stale lock file). Fix that cause, then run the block again.

After each of the last three actions, read the three again: an action that worked lands in the
first case. Each of those actions is taken once: when the reads land in the same case again after
it, stop and hand them to the maintainer.

**The MCP Registry record publishes automatically on every tag.** The `mcp-registry` job in
`publish.yml` runs after the npm publish and the Release succeeded, reads `server.json` from the
`build` job's artifact (it checks out nothing), waits until npm serves the version (`npm view`
to an 8-minute deadline, every probe bounded at 20 seconds, so the step ends by about 8m40s and the
publisher's retries are spent on Registry errors), authenticates with GitHub Actions OIDC
(`mcp-publisher login github-oidc` — no token, no device flow; the Registry JWT lives five minutes,
which is why one minted on a laptop always lapsed between releases), publishes
`packages/mcp/server.json`, and verifies the record. It skips a version the Registry already has
(records are immutable; a duplicate is a hard 400), so a re-run is safe. `server.json` is bumped on
every release regardless (the vitest guard pins it to `package.json`), so nothing about the Registry is
manual any more. If the job ever fails (Registry outage), re-run it alone with
`gh run rerun <id> --failed` (inside the artifact's 7 days: release step 3 above has what a later re-run
needs). The manual path is the fallback, and a record is immutable once
published, so it is taken in this order, in one shell (bash or zsh), with this block first, after replacing the `0000000000` of its first line with the failed run's id
(from `gh run list --workflow publish.yml`). The version is READ from that run, never typed beside
it, so every step below is about the release that failed; the block has no comments, so it pastes
into an interactive zsh:

```bash
RUN=0000000000
V=$(gh run view "$RUN" --json headBranch --jq .headBranch)
V=${V#v}
URL=https://registry.modelcontextprotocol.io/v0/servers/io.github.arturogarrido%2Fclaudinho/versions/${V:?no tag read for that run}
CHECK='.server.version==$v and (.server.packages[] | select(.identifier=="@claudinho/mcp") | .version)==$v and ._meta["io.modelcontextprotocol.registry/official"].status=="active"'
echo "$V"
```

It prints the version (a tag push's run names its tag as `headBranch`); go on only if that is the
release that failed.

1. Ask the Registry whether it already has the version (the job can publish and then fail its own
   read-back): `curl -s -o /dev/null -w '%{http_code}\n' "$URL"`. `200`: it is published; publish nothing and go
   to step 5. `404`: it is not; go on. Any other answer says neither: ask again, and do not go on
   until it is one of the two.
2. Take the record from the commit the failed run ran on, never from a working tree, the index or a
   local tag (each can differ from what the run built). `${sha:?}` stops the command when the lookup
   gave nothing (with an empty commit, `git show` would read the index), and the file is written only
   when its temporary directory was made.

   ```bash
   sha=$(gh run view "$RUN" --json headSha --jq .headSha)
   d=$(mktemp -d) && f="$d/server.json" && git show "${sha:?no commit read for that run}:packages/mcp/server.json" > "$f"
   ```

   (Fetch the commit first if this clone does not hold it.)
3. Make the job's own check by hand on that file. This prints `io.github.arturogarrido/claudinho`,
   then the version twice (the record's, and its npm pin); anything else: stop.

   ```bash
   jq -r '.name, .version, (.packages[] | select(.registryType=="npm" and .identifier=="@claudinho/mcp") | .version)' "$f"
   ```
4. npm must already serve `@claudinho/mcp` at that version (the Registry fetches it). Then log in
   (device flow) and, only if the login succeeded, publish that file (a failed login leaves an older
   credential in place, and the publish would use it); the path is passed because `mcp-publisher` defaults to
   `./server.json` in the cwd.

   ```bash
   mcp-publisher login github && mcp-publisher publish "$f"
   ```
5. Verify the record as the job's last step does, after a publish and after a `200` alike. It prints
   `active` only when the request succeeded AND the record passes; anything else (no output: a wrong
   pin, a status that is not `active`, a failed or cut-short request)
   is not a finished release: stop and decide with the maintainer.

   ```bash
   r=$(curl -sSf "$URL") && printf '%s' "$r" | jq -e --arg v "$V" "$CHECK" >/dev/null && echo active
   ```

The `mcp-publisher`
binary is pinned by version + sha256 in the workflow; bump both together from the Registry's releases.

**Lessons (learned the hard way):**
- npm deprecated classic "Automation" tokens — use **trusted publishing**, not a token.
- A brand-new package can't have a trusted publisher pre-configured; its **first** publish must be
  a manual `pnpm -F @claudinho/<pkg> publish --access public` (enter OTP), then add its trusted
  publisher for later releases.
- Account 2FA set to "Authorization and writes" forces an OTP that CI can't supply; trusted
  publishing (OIDC) sidesteps it entirely.
- The credential and the dependencies never share a job (a security review, Nov 10, 2026): when one
  job installed and ran every dev dependency while holding `id-token: write`, a compromised
  dependency arriving in a merged bump could have published any version of the three packages with
  valid provenance. `packages/core/test/publish-workflow.test.ts` refuses a job that holds
  `id-token: write` and checks out the repository, installs anything, or runs a file. The artifact
  is data to those jobs, never configuration: npm applies any config key a manifest's
  `publishConfig` holds, so the publish job refuses a `publishConfig` other than
  `{"access":"public"}`, passes the registry on the command line, and runs npm outside the artifact's
  directory. The manifest it checks is read by npm's own reader (`pacote.manifest`, the call `npm
  publish` makes for a tarball), after a filter that refuses any archive `pnpm pack` does not write:
  a second reader of the same bytes was bypassed twice in review (a config key, then a second
  `package.json` the first reader never saw). A compromised build-time dependency can still alter
  the tarball `build` makes; the split does not close that.
- Node 22's bundled npm (10.x) is too old for trusted publishing (11.5.1 or later); the `publish`
  job runs Node 24 and refuses an older npm rather than installing one beside the credential.
