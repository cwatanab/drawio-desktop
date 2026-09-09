# Selection improvements: implementation and verification

Issue: https://github.com/cwatanab/drawio-desktop/issues/1

This implements the interaction rules in [preimplementation.md](preimplementation.md).
The source editor, generated application bundle and both viewer bundles have been verified.

## Changed files

- `drawio/src/main/webapp/js/grapheditor/Graph.js`: selection-only hit testing, direct child selection, ancestor hover handles, hierarchy labels, default move handles, and locked-group editing protection. Selection hit testing is separate from the existing connection and drop-target hit testing.
- `drawio/src/main/webapp/js/app.min.js`, `viewer.min.js` and `viewer-static.min.js`: generated runtime bundles rebuilt from the modified editor source. The viewer files are in the same `js` directory as `app.min.js`.
- `src/test/selection-container.test.js`: focused regression tests for geometry, opacity, hover retention and hierarchy labels.
- `src/test/selection-gui.cjs` and `selection-gui-driver.cjs`: repeatable Electron interaction tests, viewer smoke checks and optional screenshots. Both files are in `src/test`.
- `package.json`: includes the selection unit tests in `npm test` and adds `test:selection-gui`.
- `docs/selection`: preserves the preimplementation analysis, eleven-page reproduction drawing and this implementation/verification record.

The pre-existing local `src/main/disableUpdate.js` change is independent of selection behavior and is not included in the selection commits.

## Behavior

- Normal clicks select children directly in groups and containers, including nested groups. Repeated normal clicks retain the same target. Explicit `selectParentFirst=1` retains the existing parent-first behavior; modifier clicks retain the existing selection rules.
- Unfilled and zero-fill-opacity container interiors pass selection through to the background. An empty background clears selection or starts rubberband selection. Translucent fills, visible borders and titles remain targets. Children overlapping a border or title take priority over the container body. Explicit move and connection handles retain their own gestures.
- Ordinary rectangles also pass selection through their unfilled or zero-fill-opacity interiors. A visible rear rectangle border can be selected and dragged through a front rectangle, including across layers. Exactly overlapping painted targets retain frontmost priority. This does not turn rectangles into groups or extend rectangular border testing to arbitrary shape geometries.
- Hovering a child shows ancestor outlines and handles without adding ancestors to the selection model. Overlapping hover handles are shifted outward. Crossing background cells inside the hinted area keeps the handles reachable. Hint outlines have no SVG stroke hit target, so an outer outline cannot intercept an inner handle.
- Move handles are enabled by default for vertices other than shape parts. Explicit `moveIcon=0` remains respected. Selected background shapes can be moved from their handle without moving foreground shapes.
- Movable and selectable are separate: a `movable=0` parent still has a selection handle. Group locks redirect child selection and movement to the group and now also prevent child label editing. Cell and layer movement locks remain enforced.
- Hover and selected-ancestor handles use native SVG title elements showing the parent label and hierarchy level. The outermost container is level 1.
- Selection does not modify geometry or stacking order. `transparentBounds` and `defaultTransparentGroups` retain their existing automatic-boundary semantics; this change does not convert existing groups.

The selection border tolerance uses the graph's existing pointer tolerance, adjusted for CSS zoom. Hover handles use the existing 16-pixel move icon, a 12-pixel corner offset, and an additional 24-pixel diagonal shift when hover handles overlap. A 32-pixel margin around each hint keeps the path to its handle reachable. Hover icons remain screen-sized at normal view zoom and account for CSS transforms separately.

## Repeatable checks

From the repository root:

```sh
npm test
npm run test:selection-gui
npm run test:selection-gui -- --bundled
npm run test:selection-gui -- --viewer-only
```

The GUI runner requires an available display. On Linux, run it under Xvfb if there is no desktop session. Where the Electron sandbox helper cannot start, an explicitly approved local test run can add `--no-sandbox`; it is not enabled by the test script itself.

The GUI runner serves the repository's editor assets on loopback, creates an isolated temporary Electron profile, loads [reproduction.drawio](reproduction.drawio), and sends native mouse and keyboard events. `--bundled` tests `app.min.js`; otherwise it tests source scripts. `--extended-only` runs only the additional interaction cases. `--viewer-only` checks rendering and cleanup using both generated viewer bundles. `--screenshot=/tmp/selection.png` also captures the nested-group hover and selection states. Renderer errors fail the run. The harness exercises the real Graph renderer and event handlers, not Desktop dialogs, installer packaging, or platform-native menus.

The source unit tests extract the actual Graph methods and supply small geometry/event/DOM stubs. They cover opacity, border tolerance, hover retention, CSS coordinate conversion and hierarchy-title text. They do not substitute for native pointer tests.

To regenerate the tracked runtime bundles with Java and Ant available:

```sh
cd drawio/etc/build
ant -f build.xml app
```

This updates `app.min.js`, `viewer.min.js` and `viewer-static.min.js` when Graph changes. `DRAWIO_ENV=dev npm start` uses source scripts; ordinary `npm start` uses the generated application bundle.

## Initial implementation evidence recorded on 2026-09-09

- Both the final source and final bundled GUI runs passed **435 assertions each** at 50%, 100% and 200% zoom. They covered all ten fixture pages, direct and repeated selection, transparency, rubberband selection, dragging, parent-first compatibility, group/cell/layer locks, Shift selection, double-click editing, Escape, Undo/Redo, serialization/reload, nested handles, background move handles, parent-border/title overlap, connection creation, automatic bounds after deletion/resize, and avoiding double movement after region selection.
- The runs also verified native SVG hierarchy titles before and after selection, parent-border dragging, reaching a handle across a background cell, and rotated transparent containers. Explicit connection points are tested separately from ordinary border dragging.
- The initial selection unit file contained **7 passing tests**, including the hierarchy-title implementation. All five test files in `npm test` passed.
- The final source and both GUI runner files pass syntax checks; both repository diffs pass whitespace checks.
- The final source was rebuilt successfully with the repository's Ant `app` target: all compiler tasks reported zero errors and zero warnings. The current runtime bundles include `updateSelectionContainerHandleTitle`.
- Both `viewer.min.js` and `viewer-static.min.js` successfully rendered the nested-group fixture and destroyed the graph without renderer errors.
- Captures of the final bundled hover and selection states were visually inspected at 100% zoom. Inner and outer outlines are distinct, handles are separated, and only the selected child has resize handles.

Source and generated bundles are committed inside the `drawio` Git submodule. The Desktop commit records that submodule revision together with the tests and documentation. Installer creation and publishing are outside this implementation task.

Initial editor revision: `211258f958af3741a469dccc187fa1733b7efdba` (`fix(selection): match clicks to visible shapes`).

## Follow-up: overlapping unfilled rectangles

The original selection filter applied only to groups and containers. An ordinary front rectangle therefore intercepted clicks anywhere inside its bounds, hiding the rear rectangle's visible border from selection. `isSelectionBackground` now includes ordinary `mxRectangleShape` vertices and plain `mxLabel` rectangles (used by the application bundle), while excluding shape parts, tables and labels with images or indicators. Group propagation and ancestor handles still use the separate container predicate.

Fixture page 11 reproduces the report. The regression failed before the fix: clicking the rear border selected the front rectangle. The added native-pointer checks cover repeated selection, reversed stacking order, separate layers, dragging the rear border, blank-area rubberband selection, zero fill opacity, `pointerEvents=0`, translucent fill, and unchanged serialization after selection. Use `--rectangles-only` to run these 57 assertions alone.

Verification on 2026-09-09 after the final follow-up changes:

- Source and rebuilt application bundle each passed **492 GUI assertions**, covering all eleven pages at 50%, 100% and 200% zoom plus the extended interaction cases.
- All **8 selection unit tests** and all five files in `npm test` passed. The unit tests also exclude image/indicator-bearing labels from rectangular pass-through.
- Ant `app` completed with zero compiler errors and warnings. Both rebuilt viewer bundles passed rendering and cleanup smoke checks.
- Changed JavaScript passed syntax checks, and both repository diffs passed whitespace checks.

Follow-up editor revision: `cc95cf5` (`fix(selection): reach rear rectangle borders`). The Desktop commit records the updated submodule revision, tests and reproduction drawing. Publishing is not included.

Outstanding report (2026-09-10): clicking visible borders of overlapping unfilled rectangles can sometimes leave neither rectangle selectable. This intermittent case has not been reproduced or fixed; a sample drawing and click location are still needed. The passing regression cases above do not establish that this report is resolved.
