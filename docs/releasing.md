# Releasing

Two artefacts, one build, one tag: the zip attached to the GitHub release and
the `applyflow` package on npm are the same `chrome-mv3` output.

## Cutting a release

```bash
git tag v1.0.0 && git push --tags
```

`.github/workflows/release.yml` then typechecks, tests, checks the tag against
`package.json`, builds and zips, publishes to npm, and attaches the zips to a
GitHub release. The manifest reads its version from `extension/package.json`,
so that file and the tag are the only two numbers that have to agree.

## npm credentials: prefer none

npm publishing is **tokenless**. Trusted publishing exchanges the workflow's
OIDC identity for a short-lived credential, so there is no long-lived secret in
the repository to leak, rotate or scope. The trust is pinned on npmjs.com to
this repository *and* this workflow file; nothing else can publish as this
package.

Requirements, all already in place:

- `id-token: write` in the workflow's `permissions`
- a GitHub-hosted runner (self-hosted is not supported)
- npm 11.5.1+, which the workflow installs because Node 22 bundles npm 10
- a public repository, for provenance

### Setting it up

npm cannot pin a trusted publisher to a package that does not exist, so the
very first version is a manual publish:

```bash
npm login
node packaging/npm/build.mjs
npm publish packaging/npm --access public
```

Then on npmjs.com → the `applyflow` package → **Settings** → **Trusted
publisher**, add:

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `jordanavery` |
| Repository | `ApplyFlow` |
| Workflow filename | `release.yml` |
| Environment | leave empty |

Finally, set the repository variable that turns the step on — a variable rather
than a secret, because there is no secret any more:

```bash
gh variable set NPM_PUBLISH --body true
```

Every later release publishes itself with no credential stored anywhere.

### If you use a token instead

Only worth it to avoid the one manual publish above. A granular access token,
scoped as tightly as npm allows:

| Setting | Value |
|---|---|
| Packages and scopes | **Read and write**, restricted to the `applyflow` package only |
| Organizations | **No access** |
| Allowed IP ranges | leave empty — GitHub's runner addresses are dynamic and change without notice |
| Expiration | the shortest you will actually remember to rotate |

Store it as the `NPM_TOKEN` secret and set `NPM_PUBLISH` to `true`. Note that
the package must already exist before npm will let you scope a token to it —
before that, the only option is write access to *every* package on the account,
which is a broad credential to leave sitting in CI. That is the reason to do
the first publish by hand and then switch to OIDC.

Delete the secret once trusted publishing works.

## Checking a release

```bash
npx applyflow@latest
```

Unpacks it; the printed version should match the tag. Load it unpacked and walk
one real application end to end — that is the check no test covers.
