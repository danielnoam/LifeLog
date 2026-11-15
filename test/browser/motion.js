// Motion through keel's engine (src/motion.js): the springs styles.css
// uses come from it, the desktop tier has no overshoot, and Animations off
// in Settings → Appearance stops every transition, the press dip with them,
// and stays off after a reload.
const { chromium, BASE } = require("./harness");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "  ok   - " : "  FAIL - ") + n + (ok || extra === undefined ? "" : "  [" + JSON.stringify(extra) + "]")); };

const springs = () => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const pts = (c) => (c.match(/linear\((.*)\)/) || ["", ""])[1].split(",").map(Number);
  return {
    soft: v("--spring-soft"), softMs: v("--spring-soft-ms"), snappy: v("--spring-snappy"), snappyMs: v("--spring-snappy-ms"),
    softMax: Math.max(...pts(v("--spring-soft"))), snappyMax: Math.max(...pts(v("--spring-snappy"))),
    engine: !!window.LifeLogMotion && v("--spring-soft") === v("--ll-spring-sheet"),
  };
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const watch = (page) => {
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  };

  // A phone: LifeLog's own springs, overshooting as they always did.
  const phone = await b.newPage({ viewport: { width: 400, height: 860 }, hasTouch: true });
  watch(phone);
  await phone.goto(BASE + "/", { waitUntil: "networkidle" });
  const p = await phone.evaluate(springs);
  check("the springs come from the engine", p.engine, p);
  check("on touch, snappy overshoots ~12% and soft ~1.5%",
    p.snappyMax > 1.1 && p.snappyMax < 1.16 && p.softMax > 1.005 && p.softMax < 1.03, [p.snappyMax, p.softMax]);
  check("each comes with its duration", /^\d+ms$/.test(p.softMs) && /^\d+ms$/.test(p.snappyMs), [p.softMs, p.snappyMs]);

  // A computer with a mouse: critically damped, no overshoot.
  const desk = await b.newPage({ viewport: { width: 1280, height: 900 } });
  watch(desk);
  await desk.goto(BASE + "/", { waitUntil: "networkidle" });
  const d = await desk.evaluate(springs);
  check("with a mouse on a big screen, neither overshoots", d.engine && d.softMax <= 1 && d.snappyMax <= 1, d);
  check("and both are quicker", parseInt(d.softMs) < parseInt(p.softMs) && parseInt(d.snappyMs) < parseInt(p.snappyMs), [d.softMs, d.snappyMs]);

  // Animations off, from the switch in Settings → Appearance.
  await desk.click("#settingsBtn");
  await desk.waitForSelector("#settingsModal:not([hidden])");
  await desk.click('.srow[data-page="appearance"]');
  await desk.waitForSelector("#motionSwitch", { state: "visible" });
  check("Animations starts on", await desk.isChecked("#motionSwitch"));
  await desk.click('label:has(#motionSwitch)');
  const off = await desk.evaluate(() => {
    const btn = document.querySelector("#settingsModal button");
    const cs = getComputedStyle(btn);
    return { attr: document.documentElement.dataset.motion, transition: cs.transitionDuration, still: window.LifeLogMotion.still() };
  });
  check("turning it off marks the page and stops transitions", off.attr === "off" && off.still && /^0s(, 0s)*$/.test(off.transition), off);
  const dip = await desk.evaluate(() => {
    const btn = [...document.querySelectorAll("#settingsModal button")].find((x) => x.offsetWidth);
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    const n = btn.getAnimations().length;
    window.dispatchEvent(new PointerEvent("pointerup"));
    return n;
  });
  check("and a press doesn't dip", dip === 0, dip);

  await desk.reload({ waitUntil: "networkidle" });
  check("it stays off after a reload", await desk.evaluate(() => document.documentElement.dataset.motion === "off"));

  // On again: presses dip.
  await desk.evaluate(() => window.LifeLogMotion.setStill(false));
  const on = await desk.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((x) => x.offsetWidth);
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    const n = btn.getAnimations().length;
    window.dispatchEvent(new PointerEvent("pointerup"));
    return n;
  });
  check("with motion on, a press dips", on > 0, on);

  check("no page errors", errs.length === 0, errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
