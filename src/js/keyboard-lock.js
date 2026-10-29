// Cat lock: the header cat button swallows every key until it is clicked again.
(function () {
  const btn = document.getElementById("catLock");
  if (!btn) return;
  let locked = false;
  const swallow = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const EVENTS = ["keydown", "keypress", "keyup"];
  function set(on) {
    locked = on;
    EVENTS.forEach(t => (on ? window.addEventListener(t, swallow, true) : window.removeEventListener(t, swallow, true)));
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "Keyboard locked (cat mode): click to unlock" : "Cat mode: lock the keyboard so cats cannot type";
    if (on && document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  btn.addEventListener("click", () => set(!locked));
  set(false);
})();
