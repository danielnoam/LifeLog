// LifeLog — Google Wallet payments offered to the Ledger (0.238.0), the
// Android app only. The phone does the work (native/widgets: Payments,
// PaymentListener); this is the switch for it, on Settings → Imports, and
// the two things it needs from Android: notification access, to see
// Wallet's notification, and LifeLog's own notifications, to offer it.
// The switch lives on the phone, not in the synced data: it means nothing
// anywhere else.
(function () {
  "use strict";

  let ctx = null;
  let last = { on: false, access: false, notify: "granted" };
  const plugin = () => (ctx && ctx.Platform.android && ctx.Platform.plugin("Widgets")) || null;

  async function refresh() {
    const W = plugin();
    if (!W || !W.paymentsState) return;
    try {
      const s = await W.paymentsState();
      let notify = "granted";
      try { notify = (await W.notificationState()).state; } catch (e) { /* assume they show */ }
      last = { on: !!s.on, access: !!s.access, notify };
    } catch (e) { return; }
    render();
  }

  function render() {
    const $ = ctx.$;
    $("#paymentsOn").value = last.on ? "on" : "off";
    const sub = $("#paymentsSub"), fix = $("#paymentsFixBtn");
    fix.hidden = true;
    if (!last.on) { sub.textContent = ""; return; }
    if (!last.access) {
      sub.textContent = "Needs notification access before it can see a payment";
      fix.textContent = "Give notification access";
      fix.hidden = false;
    } else if (last.notify !== "granted") {
      sub.textContent = "LifeLog's notifications are off, so the offer can't show";
      fix.textContent = "Allow notifications";
      fix.hidden = false;
    } else {
      sub.textContent = "Watching for Google Wallet payments";
    }
  }

  async function askToNotify() {
    const W = plugin();
    let now = last.notify;
    if (now === "prompt") {
      try { now = (await W.askForNotifications()).state; } catch (e) { /* treated as not allowed */ }
    }
    if (now !== "granted") W.openNotificationSettings();
    await refresh();
  }

  function fixIt() {
    if (!last.access) plugin().openPaymentAccess();
    else askToNotify();
  }

  async function setOn(on) {
    const W = plugin();
    if (!W) return;
    try { await W.setPayments({ on }); } catch (e) { ctx.toast("Couldn't change that: " + (e.message || e), true); }
    await refresh();
    if (!on) return;
    // Straight to what's missing: there's nothing to see until both are given.
    if (last.notify === "prompt") await askToNotify();
    if (!last.access) W.openPaymentAccess();
  }

  // For the Imports row on the Settings list.
  const summary = () => (plugin() && last.on ? "Google Wallet" : "");

  // ctx: { $, Platform, toast }
  function start(c) {
    ctx = c;
    if (!plugin()) return;
    ctx.$("#paymentsGroup").hidden = false;
    ctx.$("#paymentsOn").onchange = (e) => setOn(e.target.value === "on");
    ctx.$("#paymentsFixBtn").onclick = fixIt;
    // Back from Android's settings, where access is given.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });
    refresh();
  }

  window.LifeLogPayments = { start, summary, refresh };
})();
