(function () {
  const form = document.getElementById("adminLoginForm");
  const error = document.getElementById("login-error");
  const submit = form.querySelector("[type=submit]");
  const submitLabel = submit.textContent;
  let timer = null;

  const showError = (message) => {
    error.textContent = message;
    error.classList.remove("hidden");
  };

  // After too many wrong passwords the server answers 429 with the seconds to wait; the button
  // stays disabled and counts down until the login may be tried again.
  function lockFor(seconds) {
    clearInterval(timer);
    let left = seconds;
    const tick = () => {
      if (left <= 0) {
        clearInterval(timer);
        submit.disabled = false;
        submit.textContent = submitLabel;
        error.classList.add("hidden");
        return;
      }
      submit.disabled = true;
      submit.textContent = `Try again in ${left}s`;
      showError(`Too many failed attempts. The login is locked for ${left} second${left === 1 ? "" : "s"}.`);
      left -= 1;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  form.addEventListener("xf:success", () => {
    window.location.href = form.dataset.redirect;
  });

  form.addEventListener("xf:error", (e) => {
    const result = e.detail;
    const retryAfter = result?.body?.error?.retryAfter;
    if (result?.status === 429 && retryAfter) {
      lockFor(retryAfter);
      XF.alert({ type: "error", title: "Login locked", message: XF.errorMessage(result) });
      return;
    }
    showError(XF.errorMessage(result, "Invalid email or password"));
  });

  document.querySelector("[data-toggle-password]").addEventListener("click", (e) => {
    const input = document.getElementById("password");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    e.currentTarget.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
})();
