// LifeLog — every date box written in the app's own date format.
//
// A native <input type="date"> draws its value in the device's language
// ("11/24/2026" on a US phone), whatever Settings → Appearance → Dates says.
// The input stays (its value, its events and the phone's own picker are
// untouched); its text is hidden and a face on top of it shows the same day
// through LifeLogDates. Typing into it on a computer shows the browser's own
// fields again until you leave it, so you can see what you type.
(function () {
  const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const faces = new WeakMap();
  const D = () => window.LifeLogDates;
  const finePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;

  function paint(input) {
    const face = faces.get(input);
    if (!face) return;
    const v = VALUE.get.call(input);
    face.textContent = v && D() ? D().day(v) : "";
    const cs = getComputedStyle(input);
    face.style.paddingLeft = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + "px";
    face.style.fontSize = cs.fontSize;
  }

  function enhance(input) {
    if (!(input instanceof HTMLInputElement) || input.type !== "date" || faces.has(input) || !input.parentNode) return;
    const wrap = document.createElement("span");
    wrap.className = "date-field";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const face = document.createElement("span");
    face.className = "date-face";
    face.setAttribute("aria-hidden", "true");
    wrap.appendChild(face);
    input.classList.add("has-face");
    faces.set(input, face);
    // Sheets fill their boxes with `input.value = …`, which fires no event.
    Object.defineProperty(input, "value", {
      configurable: true,
      get() { return VALUE.get.call(this); },
      set(v) { VALUE.set.call(this, v); paint(this); },
    });
    const typing = (on) => wrap.classList.toggle("is-typing", on);
    input.addEventListener("input", () => paint(input));
    input.addEventListener("change", () => paint(input));
    input.addEventListener("keydown", (e) => { if (/^[0-9]$|^Arrow(Up|Down)$|^Backspace$|^Delete$/.test(e.key)) typing(true); });
    input.addEventListener("blur", () => { typing(false); paint(input); });
    // A phone opens its picker on a tap already; a mouse click on a date box
    // only lands in one of its fields, which are hidden here.
    input.addEventListener("click", () => {
      if (!finePointer() || wrap.classList.contains("is-typing") || input.readOnly || input.disabled) return;
      try { input.showPicker(); } catch { /* not allowed or not there: the box still takes typing */ }
    });
    paint(input);
  }

  function enhanceAll(root) {
    (root || document).querySelectorAll('input[type="date"]').forEach(enhance);
  }
  // After the date format changes: every face redrawn in the new one.
  function refresh() {
    document.querySelectorAll("input.has-face").forEach(paint);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => enhanceAll());
  else enhanceAll();

  window.LifeLogDateField = { enhance, enhanceAll, refresh };
})();
