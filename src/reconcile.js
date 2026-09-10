// LifeLog — keyed reconciliation: update a container's children in place
// instead of clearing and rebuilding it.
//
// Every view in the app used to render by throwing its DOM away
// (`container.innerHTML = ""`) and building it again. That is simple and it
// is why `render()` can be called from anywhere, but it costs the one thing
// animation needs: a node you can animate has to still be there afterwards.
// A ticked to-do could never slide down to the completed group because the
// row that was ticked no longer existed — a different row, in a different
// place, took its turn.
//
// This file is the missing half: give each item a stable key, and the
// container keeps the node that already belongs to that key.
//
// The module is split so the interesting part is testable. `diffKeys` is
// pure — two arrays of strings in, a list of operations out, no DOM — and
// test/reconcile.test.js covers it under the same zero-dependency Node
// harness every other test here uses. `reconcile` is the thin part that
// applies those ops to real elements.
//
// Keys are item ids, never object identity: merge.js rebuilds every
// collection from a Set of ids on each sync (see NOTES.md), so the objects
// themselves do not survive a reconciliation between two devices. Anything
// keyed on object identity would silently detach the first time two devices
// met.
(function () {
  // ---------- the pure half ----------

  // Indices into `seq` forming a longest strictly-increasing subsequence.
  // Patience sorting with parent pointers, O(n log n). Used to decide which
  // survivors are already in the right relative order and can therefore stay
  // where they are — everything else is a move. Picking the *longest* such
  // run is what keeps the move count minimal, which matters once moves are
  // animated: a list that reorders one row should animate one row.
  function lisIndices(seq) {
    const n = seq.length;
    if (!n) return [];
    const tails = [];                        // tails[l] = index of the smallest tail of a run of length l+1
    const prev = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      let lo = 0, hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (seq[tails[mid]] < seq[i]) lo = mid + 1; else hi = mid;
      }
      if (lo > 0) prev[i] = tails[lo - 1];
      if (lo === tails.length) tails.push(i); else tails[lo] = i;
    }
    const out = [];
    let k = tails[tails.length - 1];
    while (k !== -1) { out.push(k); k = prev[k]; }
    return out.reverse();
  }

  // Turns "these keys were here, these keys are here now" into a list of ops.
  //
  //   { op: "remove", key, from }        no longer present
  //   { op: "keep",   key, from, to }    present, and already in the right place
  //   { op: "move",   key, from, to }    present, but has to be repositioned
  //   { op: "insert", key, to }          new
  //
  // `from` indexes oldKeys, `to` indexes newKeys. Removes come first, in
  // ascending `from`; the rest follow in ascending `to`, so the list reads in
  // the order it should be applied and every new key appears exactly once.
  //
  // Duplicate keys don't throw. A bad import or a merge that produced two of
  // a thing shouldn't take a view down: the first occurrence claims the
  // existing node and any later one is treated as new.
  function diffKeys(oldKeys, newKeys) {
    const unclaimed = new Map();
    for (let i = 0; i < oldKeys.length; i++) {
      const k = oldKeys[i];
      let q = unclaimed.get(k);
      if (!q) { q = []; unclaimed.set(k, q); }
      q.push(i);
    }

    const claimed = new Array(newKeys.length).fill(-1);
    const matched = new Array(oldKeys.length).fill(false);
    for (let j = 0; j < newKeys.length; j++) {
      const q = unclaimed.get(newKeys[j]);
      if (q && q.length) {
        const i = q.shift();
        claimed[j] = i;
        matched[i] = true;
      }
    }

    const ops = [];
    for (let i = 0; i < oldKeys.length; i++) {
      if (!matched[i]) ops.push({ op: "remove", key: oldKeys[i], from: i });
    }

    const survivors = [];
    for (let j = 0; j < newKeys.length; j++) if (claimed[j] !== -1) survivors.push(j);
    const stays = new Set();
    for (const idx of lisIndices(survivors.map((j) => claimed[j]))) stays.add(survivors[idx]);

    for (let j = 0; j < newKeys.length; j++) {
      const from = claimed[j];
      if (from === -1) ops.push({ op: "insert", key: newKeys[j], to: j });
      else ops.push({ op: stays.has(j) ? "keep" : "move", key: newKeys[j], from, to: j });
    }
    return ops;
  }

  // ---------- the DOM half ----------

  // Per-container bookkeeping, off to the side rather than as expandos on the
  // elements: a container that goes out of the DOM takes its entry with it.
  const STATE = new WeakMap();

  // Refills `existing` from a freshly built `fresh` of the same kind, keeping
  // `existing` itself — which is the whole point, since that node is what a
  // transition is attached to.
  //
  // Attributes are synced in both directions. Fresh nodes used to get their
  // classes implicitly right by not having the wrong ones; a reused node
  // keeps whatever it had, so `is-done` and friends have to be removed as
  // well as added.
  //
  // Listeners bound to `existing` itself are kept, and `fresh`'s own are
  // dropped along with `fresh`. So element-level wiring belongs in `create`,
  // where it runs once per node, and never in `update`.
  function adopt(existing, fresh) {
    const attrs = existing.attributes;
    for (let i = attrs.length - 1; i >= 0; i--) {
      const name = attrs[i].name;
      if (!fresh.hasAttribute(name)) existing.removeAttribute(name);
    }
    for (const a of fresh.attributes) {
      if (existing.getAttribute(a.name) !== a.value) existing.setAttribute(a.name, a.value);
    }
    existing.replaceChildren(...fresh.childNodes);
    return existing;
  }

  // A node the user is currently typing into is left alone. Refilling it
  // would take the caret, the selection and anything uncommitted with it —
  // the to-do compose box, an inline title edit, an open category picker.
  function holdsLiveInput(node) {
    const a = document.activeElement;
    if (!a || a === document.body || !node.contains(a)) return false;
    return !!(a.matches && a.matches("input, select, textarea, [contenteditable]"));
  }

  // ---------- movement ----------
  // With node identity in place, a list that reorders can show it: measure
  // where everything was, let the diff happen, then put each moved node back
  // where it started with a transform and release it. FLIP, the same
  // technique todos.js already uses for its drag — the difference is that
  // this one runs off the op list, so it covers every reorder in the app
  // rather than one gesture.
  //
  // Deliberately opt-in per call (`animate: true`): a container whose
  // contents change wholesale has nothing worth animating, and measuring it
  // costs two forced layouts.
  const REDUCED = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function clearFlip(node) {
    node.style.transition = "";
    node.style.transform = "";
    node.removeEventListener("transitionend", node.__llFlipEnd);
    node.__llFlipEnd = null;
  }

  function playFlip(moved) {
    if (!moved.length) return;
    // Two frames: one for the browser to take the inverted position as given,
    // the next to change it. In one, the style change coalesces with the move
    // and nothing animates at all.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const node of moved) {
        node.style.transition = "transform var(--ll-move-dur) var(--ll-move-ease)";
        node.style.transform = "";
        node.__llFlipEnd = (e) => { if (e.target === node && e.propertyName === "transform") clearFlip(node); };
        node.addEventListener("transitionend", node.__llFlipEnd);
      }
    }));
  }

  // A node arriving fades and slides the short distance in. Removals are
  // deliberately not animated: holding a node in the flow while it leaves
  // means the list doesn't close up until the animation ends, and every
  // caller here would need to know that its own bookkeeping is momentarily
  // out of step with the DOM.
  function playEnter(node) {
    node.classList.add("ll-enter");
    const done = () => { node.classList.remove("ll-enter"); node.removeEventListener("animationend", done); };
    node.addEventListener("animationend", done);
  }

  // Brings `container`'s children into line with `items`.
  //
  //   keyOf(item)         -> a stable string. Item ids, not array positions.
  //   create(item)        -> a new element. Runs once per node; bind
  //                          element-level listeners here.
  //   update(node, item)  -> refresh an existing node in place. Optional;
  //                          omit it for nodes whose content never changes.
  //                          Call `adopt` from here to rebuild contents, or
  //                          reconcile the node's own children for a nested
  //                          list — which is how a panel keeps its rows'
  //                          identity while its header is rebuilt.
  //   animate             -> optional. Moves are played as FLIP transitions
  //                          and arrivals fade in. Off by default: it costs
  //                          two forced layouts, and a list whose contents
  //                          change wholesale has nothing worth animating.
  //   epoch               -> optional. When it differs from the last call's,
  //                          nothing is reused: every node is dropped and
  //                          rebuilt. This is the escape hatch for settings
  //                          that change a row's *shape* rather than its
  //                          content, where a reused node would be the wrong
  //                          node wearing the right data.
  //
  // Returns the op list, so a caller can drive animations off it.
  function reconcile(container, items, opts) {
    const keyOf = opts.keyOf;
    const create = opts.create;
    const update = opts.update;
    const epoch = opts.epoch === undefined ? null : opts.epoch;
    // Nothing off-document is worth measuring: a view holding its root across
    // a render reconciles while detached, where every rect is zero.
    const animate = !!opts.animate && container.isConnected && !REDUCED();

    let prev = STATE.get(container);
    if (!prev || prev.epoch !== epoch) {
      if (prev) for (const node of prev.nodes.values()) node.remove();
      prev = { epoch, keys: [], nodes: new Map() };
    }

    const newKeys = [];
    const byKey = new Map();
    const seen = new Set();
    for (const item of items) {
      let k = String(keyOf(item));
      while (seen.has(k)) k += " dup";   // see diffKeys on duplicates
      seen.add(k);
      newKeys.push(k);
      byKey.set(k, item);
    }

    const ops = diffKeys(prev.keys, newKeys);

    // Measured before anything moves, and only for nodes actually in place.
    const before = animate ? new Map() : null;
    if (animate) {
      for (const [key, node] of prev.nodes) {
        if (node.parentNode !== container) continue;
        const r = node.getBoundingClientRect();
        before.set(key, { left: r.left, top: r.top });
      }
    }

    for (const op of ops) {
      if (op.op !== "remove") continue;
      const node = prev.nodes.get(op.key);
      if (node) node.remove();
    }

    // Backwards, each node placed before the one that follows it: by the time
    // a node is positioned its successor is already final, so one pass does
    // it. The guard reads the live DOM rather than trusting the recorded
    // order, which keeps this correct even when something else has moved
    // nodes since the last call — the to-do drag reorders rows under the
    // finger and only then asks for a render.
    const nodes = new Map();
    const entered = animate ? new Set() : null;
    let anchor = null;
    for (let j = newKeys.length - 1; j >= 0; j--) {
      const key = newKeys[j];
      const item = byKey.get(key);
      let node = prev.nodes.get(key);
      // A node that is no longer our child was taken out from under us —
      // something cleared the container between renders, which is exactly
      // what app.js still does to #viewBody for the views that haven't
      // converted yet. Re-inserting the detached one would resurrect stale
      // content, so forget it and build again. Note this is about the
      // *container* being emptied, not about the container itself being
      // detached: a whole subtree can be parked off-document and still be
      // internally intact, which is what lets a view hold its root across a
      // render.
      if (node && node.parentNode !== container) node = null;
      if (node) {
        if (update && !holdsLiveInput(node)) update(node, item);
      } else {
        node = create(item);
        if (update) update(node, item);
        if (animate) entered.add(key);
      }
      if (node.parentNode !== container || node.nextSibling !== anchor) {
        container.insertBefore(node, anchor);
      }
      nodes.set(key, node);
      anchor = node;
    }

    STATE.set(container, { epoch, keys: newKeys, nodes });

    if (animate) {
      const moved = [];
      for (const [key, node] of nodes) {
        if (entered.has(key)) { playEnter(node); continue; }
        const was = before.get(key);
        if (!was) continue;
        // An animation still running would otherwise be measured mid-flight
        // and inverted against its own transform.
        if (node.__llFlipEnd) clearFlip(node);
        const now = node.getBoundingClientRect();
        const dx = was.left - now.left, dy = was.top - now.top;
        if (!dx && !dy) continue;
        node.style.transition = "none";
        node.style.transform = "translate(" + dx + "px, " + dy + "px)";
        moved.push(node);
      }
      playFlip(moved);
    }
    return ops;
  }

  window.LifeLogReconcile = { diffKeys, reconcile, adopt };
})();
