# Notes for the next release

Each pull request that changes something a person can notice, and doesn't
release on its own, adds one file here named after its branch
(`feature/more-sites` → `feature-more-sites.md`), with its lines for
CHANGELOG.md:

```md
### Added
- What's new, in plain user-facing words.

### Fixed
- What was wrong, and what happens now.
```

The headings are `### Added`, `### Changed`, `### Fixed` and `### Removed`.
Only a release touches CHANGELOG.md: `node tools/release.js x.y.z` folds
every note here into the new version's entry and deletes the files. Two
branches never write the same file, so their notes never clash.
