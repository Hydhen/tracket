# Changesets

Every change a user can notice (a feature or a fix) comes with a changeset: a small file here that says what changed,
in a sentence a user of Tracket would understand. The release page is built from these files.

```bash
npm run changeset
```

Pick **minor** for something new, **patch** for a fix (and **major** for a breaking change), then write the sentence.
Commit the generated file with your change. It survives a squash merge, since it is part of the pull request.

Changes nobody will notice (docs, CI, refactors, tests) don't need a release note: run `npm run changeset -- --empty`
to say so.

When `develop` is pushed to `release`, the changesets that have landed are gathered into `CHANGELOG.md`, the
version is raised and the new version is built and published (see "Releasing" in the README).
