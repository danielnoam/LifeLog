# Browser suites

    node test/browser/run-all.js            every suite
    node test/browser/run-all.js fxrate     one (substring match)
    node test/browser/fxrate.js             one, against a server you started

`run-all.js` serves the repo on a free port and passes it down, so there is
no port to remember and no stale server to collide with. Each suite runs as
its own process: a crash takes that suite down rather than the run, and a
suite killed by the timeout can't leave `localStorage` behind for the next
one — which is how the ad-hoc scripts these grew out of used to drift.

Playwright is not a dependency of this project. `harness.js` looks for it in
the usual global spots and prints how to install it if it can't find one.

## What these are for

The unit tests under `test/` cover pure logic and never touch a DOM. These
cover the things that can only be wrong in a browser, and most of them exist
because something shipped broken that no unit test could have caught:

| suite | what it pins down |
|---|---|
| `synctoast` | the offline warning doesn't fire while the status line says "Synced" |
| `fxrate` | rate lookup: URLs, fallback order, date pinning, precision, and the hint's spacing |
| `bandfold` | each set-aside band folds on its own setting, and an all-one-band category still gets a bar |
| `droppedfold` | the Dropped fold, including that its rows are dimmed on the frame they appear |
| `sorting` | every sort option means what it says at every level |
| `everymode` | the bulk bar and progress panel in all five bulk-capable modes |
| `btnaudit` | no pressable anywhere draws the browser's tap-highlight |
| `press` | a tap still visibly responds now that the highlight is gone |
| `v151`, `importkinds`, `importmodes` | import updates: what gets filled, for which kinds, and never a duplicate |
| `boards` | the drawing board: every tool with mouse and touch, resize/rotate/fill, undo, a reload, PNG/SVG/JSON out and back, History bringing a board back, the boards file, and boards.json syncing and merging against a fake GitHub |
| `notekinds` | notes' three kinds through the sheet and the cards, categories and their chips, the kind switch, the sort, a list working like the old To-do panel (add, edit, delete, reorder, Clear), favourites, bulk move |
| `tabio` | every tab's JSON and CSV export comes back whole through that tab's import, and the full backup through Everything |
| `match` | auto-sync asks both sources and refuses a near-miss |
| `realloop` | the real bulk-sync loop feeds the progress panel live |
| `projadd` | the project pill's + opens the form already on that project |

## Writing one

Assert on what the eye reads, not on the property you changed. Three visual
regressions shipped green past tests that checked a single property — the
lesson is in NOTES.md and the shape is: compare colour *and* weight *and*
geometry, sample mid-animation when the bug is a timing one, and check that
the test fails without the fix before trusting it.
