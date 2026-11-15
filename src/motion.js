// LifeLog: motion, through keel's engine (src/keel/motion.js, shared with
// Waypage). LifeLog's two springs, fitted to the curves it used to paste
// into styles.css (0.222.0): --spring-soft is the sheet spring (~1.5%
// over), --spring-snappy the control spring (~12% over). styles.css reads
// them, and their -ms, from the --ll-spring-* variables set here, with the
// old curves as the fallback if this never runs. With a mouse on a big
// screen they run critically damped, quicker and with no overshoot. Which
// moves LifeLog makes, and how, is DESIGN.md §5.
(function () {
  window.LifeLogMotion = window.Keel.motion.create({
    touch: { sheet: [155, 19], control: [450, 22] },
    desktop: { sheet: [700, "critical"], control: [1000, "critical"] },
    desktopQuery: "(min-width: 1024px) and (pointer: fine)",
    reducedMs: 120,
    cssPrefix: "--ll-spring",
  });
})();
