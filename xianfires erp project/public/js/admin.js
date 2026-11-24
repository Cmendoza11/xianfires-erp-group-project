// Shared admin behaviour: modals (forms, confirmations, results), JSON API calls, JSON forms,
// client-side format and password checks, and safe file reading for uploads.
(function () {
  const XF = {};

  const ICONS = {
    success: '<svg fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    error: '<svg fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 8v5"/><path d="M12 16.5h.01"/><circle cx="12" cy="12" r="9"/></svg>',
    info: '<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
    close: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  // ------------------------------------------------------------- modal shell
  // XF.modal.open({ title, content, small }) -> { body, close }. Esc and the X close it.
  const openModals = [];
  XF.modal = {
    open({ title = "", content, small = false, onClose, closable = true }) {
      const overlay = document.createElement("div");
      overlay.className = "xf-modal-overlay";
      overlay.innerHTML = `
        <div class="xf-modal ${small ? "is-small" : ""}" role="dialog" aria-modal="true">
          ${title ? `<div class="xf-modal-head"><div class="xf-modal-title"></div>${closable ? `<button type="button" class="xf-modal-close" aria-label="Close">${ICONS.close}</button>` : ""}</div>` : ""}
          <div class="xf-modal-body"></div>
        </div>`;
      if (title) overlay.querySelector(".xf-modal-title").textContent = title;
      const body = overlay.querySelector(".xf-modal-body");
      if (content) body.append(content);
      const returnFocus = document.activeElement;
      const handle = {
        body,
        overlay,
        close() {
          const i = openModals.indexOf(handle);
          if (i >= 0) openModals.splice(i, 1);
          overlay.remove();
          returnFocus?.focus?.();
          onClose?.();
        }
      };
      overlay.querySelector(".xf-modal-close")?.addEventListener("click", () => handle.close());
      openModals.push(handle);
      document.body.appendChild(overlay);
      (body.querySelector("input:not([type=hidden]), select, textarea, button") || overlay.querySelector("button"))?.focus();
      return handle;
    },
    closeTop() {
      openModals[openModals.length - 1]?.close();
    }
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openModals.length) {
      e.preventDefault();
      XF.modal.closeTop();
    }
  });

  // Result dialog. Success closes by itself; errors wait for OK.
  XF.alert = function ({ type = "info", title, message = "", autoClose } = {}) {
    return new Promise((resolve) => {
      const box = document.createElement("div");
      box.className = `xf-alert is-${type}`;
      box.setAttribute("role", type === "error" ? "alert" : "status");
      box.innerHTML = `<div class="xf-alert-icon">${ICONS[type] || ICONS.info}</div><div class="xf-alert-title"></div><div class="xf-alert-message"></div>
        <div class="mt-5"><button type="button" class="btn ${type === "error" ? "btn-destructive" : "btn-primary"} min-w-[6rem]">OK</button></div>`;
      box.querySelector(".xf-alert-title").textContent = title || (type === "success" ? "Done" : type === "error" ? "Something went wrong" : "Notice");
      box.querySelector(".xf-alert-message").textContent = message;
      const handle = XF.modal.open({ content: box, small: true, onClose: () => resolve() });
      box.querySelector("button").addEventListener("click", () => handle.close());
      const wait = autoClose ?? (type === "success" ? 1400 : 0);
      if (wait) setTimeout(() => handle.close(), wait);
    });
  };

  // Kept for page scripts: every toast is now a result modal.
  XF.toast = function (type, message) {
    if (type === "success") return XF.alert({ type: "success", title: message });
    return XF.alert({ type: type === "error" ? "error" : "info", message });
  };

  // Resolves to { ok, status, body }; network failures resolve with ok=false instead of throwing.
  XF.api = async function (method, url, data) {
    const options = { method, headers: { Accept: "application/json" }, credentials: "same-origin" };
    if (data !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(data);
    }
    try {
      const response = await fetch(url, options);
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (response.status === 401 && !url.includes("/user/login")) {
        window.location.href = "/admin/login?expired=1";
      }
      return { ok: response.ok && !body?.error, status: response.status, body };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  };

  XF.errorMessage = function (result, fallback) {
    if (result?.status === 0) return "The server cannot be reached. Check the connection and try again.";
    return result?.body?.error?.message || fallback || "Something went wrong! Please try again.";
  };

  // tone "danger" (delete, void) or "primary" (save, run).
  XF.confirm = function ({ heading, content, confirmText = "Delete", cancelText = "Cancel", tone = "danger" }) {
    return new Promise((resolve) => {
      const box = document.createElement("div");
      box.innerHTML = `<div class="text-sm text-muted" data-content></div>
        <div class="flex justify-end gap-2 mt-5">
          <button type="button" class="btn btn-secondary" data-cancel></button>
          <button type="button" class="btn ${tone === "danger" ? "btn-destructive" : "btn-primary"}" data-confirm></button>
        </div>`;
      box.querySelector("[data-content]").textContent = content || "";
      box.querySelector("[data-cancel]").textContent = cancelText;
      box.querySelector("[data-confirm]").textContent = confirmText;
      let answer = false;
      const handle = XF.modal.open({ title: heading, content: box, small: true, onClose: () => resolve(answer) });
      box.querySelector("[data-cancel]").addEventListener("click", () => handle.close());
      box.querySelector("[data-confirm]").addEventListener("click", () => {
        answer = true;
        handle.close();
      });
      box.querySelector("[data-confirm]").focus();
    });
  };

  XF.setLoading = function (button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.dataset.loading = loading ? "true" : "false";
  };

  // ------------------------------------------------------------- validation (UI layer)
  function fieldHost(field) {
    return field.closest("label") || field.parentElement;
  }

  function showFieldError(field, message) {
    field.classList.add("invalid");
    field.setAttribute("aria-invalid", "true");
    const host = fieldHost(field);
    let error = host.querySelector(".field-error");
    if (!error) {
      error = document.createElement("p");
      error.className = "field-error";
      host.appendChild(error);
    }
    error.textContent = message;
  }

  function clearFieldError(field) {
    field.classList.remove("invalid");
    field.removeAttribute("aria-invalid");
    fieldHost(field).querySelector(".field-error")?.remove();
  }

  // Same rules as the server (services/securityService.js).
  const PASSWORD_RULES = {
    length: (p) => p.length >= 8,
    upper: (p) => /[A-Z]/.test(p),
    lower: (p) => /[a-z]/.test(p),
    number: (p) => /\d/.test(p),
    symbol: (p) => /[^A-Za-z0-9\s]/.test(p),
    space: (p) => p.length > 0 && !/\s/.test(p)
  };
  const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  const UNSAFE_TEXT = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

  function updatePasswordRules(input) {
    const list = input.closest("div")?.parentElement?.querySelector("[data-password-rules]") || fieldHost(input).querySelector("[data-password-rules]");
    if (!list) return;
    list.querySelectorAll("[data-rule]").forEach((li) => li.classList.toggle("ok", PASSWORD_RULES[li.dataset.rule](input.value)));
  }

  // [data-required], [data-maxlength], [data-pattern] + [data-pattern-message], type=email,
  // [data-password-policy], [data-match="other_field"], type=number min/max, and no < > in text.
  XF.validateForm = function (form) {
    let valid = true;
    const fail = (field, message) => {
      showFieldError(field, message);
      valid = false;
    };
    form.querySelectorAll("[name]:not([type=hidden]):not([type=checkbox]):not([type=file])").forEach((field) => {
      if (field.disabled) return;
      clearFieldError(field);
      const value = field.value.trim();
      const d = field.dataset;
      if (d.required && !value) return fail(field, d.required);
      if (!value) return;
      if (d.maxlength && value.length > Number(d.maxlength)) return fail(field, d.maxlengthMessage);
      if (field.maxLength > 0 && value.length > field.maxLength) return fail(field, `Use ${field.maxLength} characters or fewer`);
      if (field.type === "email" && !EMAIL.test(value)) return fail(field, "Enter a valid email address, e.g. name@company.com");
      if (d.pattern && !new RegExp(d.pattern).test(value)) return fail(field, d.patternMessage || "The format is not valid");
      if (field.type === "number") {
        const n = Number(value);
        if (!Number.isFinite(n)) return fail(field, "Enter a number");
        if (field.min !== "" && n < Number(field.min)) return fail(field, `The minimum is ${field.min}`);
        if (field.max !== "" && n > Number(field.max)) return fail(field, `The maximum is ${field.max}`);
      }
      if ((field.tagName === "TEXTAREA" || field.type === "text" || field.type === "search") && UNSAFE_TEXT.test(value)) {
        return fail(field, "Remove the < > characters");
      }
      if (d.passwordPolicy !== undefined && !Object.values(PASSWORD_RULES).every((rule) => rule(field.value))) {
        updatePasswordRules(field);
        return fail(field, "The password does not meet every rule below");
      }
      if (d.match) {
        const other = form.querySelector(`[name="${d.match}"]`);
        if (other && other.value !== field.value) return fail(field, d.matchMessage || "The values do not match");
      }
    });
    form.querySelectorAll("input[type=file][data-upload]").forEach((input) => {
      clearFieldError(input);
      const problem = checkFile(input.files[0], input);
      if (problem) fail(input, problem);
    });
    return valid;
  };

  // Later fields with the same name win, so a ticked checkbox overrides its hidden "0" twin.
  XF.formToJson = function (form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
      if (typeof value === "string") data[key] = value;
    });
    return data;
  };

  // ------------------------------------------------------------- files (receipts)
  // A first look at the file in the browser; the server checks everything again, including the content.
  const DANGEROUS = /\.(php\d?|phtml|phar|pht|phps|inc|htaccess|asp|aspx|jsp|cgi|pl|py|sh|bat|cmd|exe|js|html?|svg|xml)(\.|$)/i;
  function checkFile(file, input) {
    if (!file) return input.dataset.required || "";
    const allowed = (input.dataset.allowed || "jpg,jpeg,png,pdf").split(",");
    const parts = file.name.toLowerCase().split(".");
    const max = Number(input.dataset.maxBytes || 2 * 1024 * 1024);
    if (DANGEROUS.test(file.name)) return "This file type is not allowed. Upload a JPG, PNG or PDF only.";
    if (parts.length !== 2 || !allowed.includes(parts[1])) return `Only ${allowed.map((x) => x.toUpperCase()).join(", ")} files with one extension are allowed.`;
    if (file.size > max) return `The file is larger than ${Math.round(max / 1024 / 1024)} MB.`;
    if (!file.size) return "The file is empty.";
    return "";
  }

  const readAsBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  async function addFiles(form, payload) {
    for (const input of form.querySelectorAll("input[type=file][data-upload]")) {
      const file = input.files[0];
      if (!file) continue;
      payload[`${input.name}_name`] = file.name;
      payload[`${input.name}_data`] = await readAsBase64(file);
    }
    return payload;
  }

  // ------------------------------------------------------------- JSON forms
  // <form data-json-form data-method="PATCH" action="/api/..."> posts JSON and dispatches "xf:success".
  // data-confirm-heading asks first; inside a modal, success shows a result and reloads the page.
  function bindForm(form) {
    if (form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!XF.validateForm(form)) return;
      if (form.dataset.confirmHeading) {
        const ok = await XF.confirm({
          heading: form.dataset.confirmHeading,
          content: form.dataset.confirmContent || "",
          confirmText: form.dataset.confirmLabel || "Save",
          tone: form.dataset.confirmTone || "primary"
        });
        if (!ok) return;
      }
      const submitBtn = document.querySelector(`[form="${form.id}"][type="submit"]`) || form.querySelector("[type=submit]");
      XF.setLoading(submitBtn, true);
      let payload;
      try {
        payload = await addFiles(form, XF.formToJson(form));
      } catch {
        XF.setLoading(submitBtn, false);
        XF.alert({ type: "error", message: "The file could not be read." });
        return;
      }
      const result = await XF.api(form.dataset.method || "POST", form.getAttribute("action"), payload);
      XF.setLoading(submitBtn, false);
      if (result.ok) {
        form.dispatchEvent(new CustomEvent("xf:success", { detail: result.body }));
      } else {
        form.dispatchEvent(new CustomEvent("xf:error", { detail: result }));
        if (!form.hasAttribute("data-custom-error")) XF.alert({ type: "error", title: "Not saved", message: XF.errorMessage(result) });
      }
    });
    form.addEventListener("input", (e) => {
      if (e.target.classList.contains("invalid")) clearFieldError(e.target);
      if (e.target.dataset?.passwordPolicy !== undefined) updatePasswordRules(e.target);
    });
    form.addEventListener("change", (e) => {
      if (e.target.type === "file" && e.target.dataset.upload !== undefined) {
        clearFieldError(e.target);
        const problem = checkFile(e.target.files[0], e.target);
        if (problem && e.target.files[0]) {
          showFieldError(e.target, problem);
          e.target.value = "";
        }
      }
      // Account form: picking a type suggests its usual normal balance.
      if (e.target.matches?.("[data-account-type]")) {
        const nb = form.querySelector("[name=normal_balance]");
        if (nb) nb.value = e.target.selectedOptions[0].dataset.normalBalance;
      }
    });
    if (form.dataset.successMessage || form.dataset.successRedirect || form.closest(".xf-modal")) {
      form.addEventListener("xf:success", (e) => afterSuccess(form, e.detail));
    }
  }

  // Declarative follow-up: data-success-message shows a result modal, then data-success-redirect goes
  // to a URL, "view" (the saved record's viewUrl) or "reload". Forms inside a modal reload by default.
  async function afterSuccess(el, body) {
    const inModal = el.closest(".xf-modal");
    const target = el.dataset.successRedirect || (inModal ? "reload" : "");
    if (inModal) XF.modal.closeTop();
    const href = target === "reload" ? window.location.href : target === "view" ? body?.data?.viewUrl : target;
    await XF.alert({ type: "success", title: el.dataset.successMessage || "Saved successfully", autoClose: target ? 900 : 1400 });
    if (target) window.location.href = href || window.location.href;
  }

  // <button data-api-action="/api/..." data-method="POST" data-confirm-heading="..."> calls an
  // endpoint after an optional confirmation. data-payload holds JSON; data-payload-from names a
  // form whose fields are sent instead.
  function bindApiAction(button) {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", async () => {
      const d = button.dataset;
      let payload = d.payload ? JSON.parse(d.payload) : undefined;
      let form = null;
      if (d.payloadFrom) {
        form = button.closest(".xf-modal-body")?.querySelector(`#${d.payloadFrom}`) || document.getElementById(d.payloadFrom);
        if (!XF.validateForm(form)) return;
      }
      if (d.confirmHeading) {
        const confirmed = await XF.confirm({
          heading: d.confirmHeading,
          content: d.confirmContent || "",
          confirmText: d.confirmLabel || "Confirm",
          tone: d.confirmTone || (d.method === "DELETE" || /void|delete|remove|undo/i.test(d.confirmLabel || "") ? "danger" : "primary")
        });
        if (!confirmed) return;
      }
      if (form) {
        try {
          payload = await addFiles(form, XF.formToJson(form));
        } catch {
          return XF.alert({ type: "error", message: "The file could not be read." });
        }
      }
      XF.setLoading(button, true);
      const result = await XF.api(d.method || "POST", d.apiAction, payload);
      XF.setLoading(button, false);
      if (result.ok) afterSuccess(button, result.body);
      else XF.alert({ type: "error", title: "Not done", message: XF.errorMessage(result) });
    });
  }

  XF.bindForms = function (root = document) {
    root.querySelectorAll("form[data-json-form]").forEach(bindForm);
    root.querySelectorAll("[data-api-action]").forEach(bindApiAction);
  };

  // ------------------------------------------------------------- modal forms
  // [data-modal-target="#templateId"] opens a <template>'s form in a modal. For editing, add
  // data-modal-values='{"field":"value"}', data-modal-action="/api/..." and data-modal-method="PATCH".
  function fillForm(form, values) {
    for (const [name, value] of Object.entries(values || {})) {
      form.querySelectorAll(`[name="${name}"]`).forEach((field) => {
        if (field.type === "checkbox") field.checked = [true, 1, "1", "true"].includes(value);
        else if (field.type !== "file") field.value = value ?? "";
      });
    }
  }

  function openTemplateModal(trigger) {
    const template = document.querySelector(trigger.dataset.modalTarget);
    if (!template) return;
    const wrap = document.createElement("div");
    wrap.append(template.content ? template.content.cloneNode(true) : template.cloneNode(true));
    const form = wrap.querySelector("form");
    const editing = Boolean(trigger.dataset.modalMethod);
    if (form) {
      if (trigger.dataset.modalAction) form.setAttribute("action", trigger.dataset.modalAction);
      if (editing) form.dataset.method = trigger.dataset.modalMethod;
      if (trigger.dataset.modalValues) fillForm(form, JSON.parse(trigger.dataset.modalValues));
      if (trigger.dataset.modalSuccess) form.dataset.successMessage = trigger.dataset.modalSuccess;
      (trigger.dataset.modalLock || "").split(",").filter(Boolean).forEach((name) => {
        form.querySelectorAll(`[name="${name}"]`).forEach((field) => { field.disabled = true; });
      });
    }
    wrap.querySelectorAll(editing ? "[data-only-new]" : "[data-only-edit]").forEach((el) => el.remove());
    const handle = XF.modal.open({ title: trigger.dataset.modalTitle || template.dataset.title || "", content: wrap });
    wrap.querySelectorAll("[data-modal-cancel]").forEach((b) => b.addEventListener("click", () => handle.close()));
    XF.bindForms(handle.body);
    handle.body.querySelector("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea")?.focus();
  }

  // a[data-modal] (its href) or [data-modal-url] loads that page's form into a modal.
  async function openRemoteModal(trigger) {
    const url = trigger.dataset.modalUrl || trigger.getAttribute("href");
    const note = document.createElement("p");
    note.className = "text-sm text-muted";
    note.textContent = "Loading…";
    const loading = XF.modal.open({ title: trigger.dataset.modalTitle || "Loading…", content: note });
    let html;
    try {
      const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "text/html" } });
      if (response.redirected && /\/admin\/login/.test(response.url)) {
        window.location.href = "/admin/login?expired=1";
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      html = await response.text();
    } catch {
      loading.close();
      XF.alert({ type: "error", message: "The form could not be opened. Try again." });
      return;
    }
    loading.close();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const form = doc.querySelector("main form[data-json-form]");
    if (!form) {
      window.location.href = url;
      return;
    }
    const title = trigger.dataset.modalTitle || doc.querySelector("main h1")?.textContent.trim() || "";
    const node = document.importNode(form, true);
    node.querySelectorAll(".form-submit-button a").forEach((a) => {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = a.className;
      cancel.textContent = a.textContent;
      cancel.dataset.modalCancel = "";
      a.replaceWith(cancel);
    });
    // In a modal, saving always comes back to this list.
    delete node.dataset.successRedirect;
    if (!node.dataset.successMessage) node.dataset.successMessage = "Saved successfully";
    const handle = XF.modal.open({ title, content: node });
    node.querySelectorAll("[data-modal-cancel]").forEach((b) => b.addEventListener("click", () => handle.close()));
    XF.bindForms(handle.body);
  }

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest?.("[data-modal-target], [data-modal-url], a[data-modal]");
    if (!trigger || e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    if (trigger.dataset.modalTarget) openTemplateModal(trigger);
    else openRemoteModal(trigger);
  });

  XF.bindForms(document);

  // Header account dropdown
  document.querySelectorAll("[data-dropdown]").forEach((dropdown) => {
    const menu = dropdown.querySelector("[data-dropdown-menu]");
    dropdown.querySelector("[data-dropdown-toggle]").addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => menu.classList.add("hidden"));
  });

  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await XF.api("GET", button.dataset.logout);
      if (result.status === 200) {
        window.location.href = button.dataset.loginUrl;
      } else {
        XF.alert({ type: "error", message: "Logout failed" });
      }
    });
  });

  document.querySelectorAll("[data-print]").forEach((button) => {
    button.addEventListener("click", () => window.print());
  });

  // ------------------------------------------------------------- export to Excel (CSV)
  // Every table on the page (what is shown now, with its filters) becomes one CSV that Excel opens.
  // Money cells (.num) are written as plain numbers so Excel can add them up.
  const csvCell = (value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const plainNumber = (text) => {
    const t = text.replace(/[₱,\s]/g, "");
    const m = t.match(/^\((-?[\d.]+)\)$/);
    if (m) return `-${m[1]}`;
    return /^-?[\d.]+$/.test(t) ? t : text;
  };
  XF.exportCsv = function (root = document.querySelector("main") || document.body) {
    const blocks = [];
    root.querySelectorAll("table").forEach((table) => {
      if (table.closest(".no-print, [data-no-export], template")) return;
      const title = table.closest(".card, section")?.querySelector(".card-title, h2, h3")?.textContent.trim();
      const rows = [];
      if (title) rows.push(csvCell(title));
      // Columns that only hold buttons (header empty or "Action(s)") are left out.
      const head = table.querySelector("thead tr");
      const skip = new Set(head ? [...head.children].map((th, i) => (/^(actions?)?$/i.test(th.innerText.trim()) ? i : -1)).filter((i) => i >= 0) : []);
      table.querySelectorAll("tr").forEach((tr) => {
        // Rows hidden by a filter are left out; rows only on another page of the list are kept.
        if ((tr.hidden || tr.classList.contains("hidden")) && tr.dataset.paged !== "1") return;
        const cells = [...tr.children].filter((c, i) => !skip.has(i) && !c.hasAttribute("data-no-export"));
        if (!cells.length) return;
        rows.push(cells.map((c) => {
          const text = c.innerText.replace(/\s+/g, " ").trim();
          return csvCell(c.classList.contains("num") ? plainNumber(text) : text);
        }).join(","));
      });
      if (rows.length) blocks.push(rows.join("\r\n"));
    });
    if (!blocks.length) return XF.alert({ type: "error", message: "There is no table on this page to export." });
    const heading = document.querySelector("main h1")?.textContent.trim() || document.title.split("·")[0].trim();
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const header = [csvCell(heading), csvCell(`Exported ${now.toLocaleString()}`), ""].join("\r\n");
    // The BOM tells Excel the file is UTF-8, so ₱ and accented names show correctly.
    const blob = new Blob([String.fromCharCode(0xfeff) + header + "\r\n" + blocks.join("\r\n\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${heading.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "export"}-${day}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  // Reports already have Print; each gets an Export button beside it. Lists add [data-export-csv].
  document.querySelectorAll("[data-print]").forEach((print) => {
    if (print.parentElement?.querySelector("[data-export-csv]")) return;
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = print.className;
    exportButton.dataset.exportCsv = "";
    exportButton.textContent = "Export to Excel";
    print.after(exportButton);
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-export-csv]")) XF.exportCsv();
  });

  // ------------------------------------------------------------- list filters and pagination
  // <div data-list data-page-size="15"> with an <input data-list-search>, <select data-list-filter="key">
  // (matched against each row's data-key), rows <tr data-row data-key="...">, an optional
  // <tr data-empty-row> and a <div data-list-pager>. The choices are kept in the address (l_ params),
  // so Back and Reload return to the same page and filters.
  const PAGE_SIZES = [10, 15, 25, 50, 100];
  function setupList(list, index) {
    const rows = [...list.querySelectorAll("tr[data-row]")];
    const search = list.querySelector("[data-list-search]");
    const filters = [...list.querySelectorAll("[data-list-filter]")];
    const pager = list.querySelector("[data-list-pager]");
    const count = list.querySelector("[data-list-count]");
    const emptyRow = list.querySelector("tr[data-empty-row]");
    const prefix = index ? `l${index}_` : "l_";
    const params = new URLSearchParams(window.location.search);
    let size = Number(params.get(`${prefix}size`)) || Number(list.dataset.pageSize) || 15;
    let page = Math.max(1, Number(params.get(`${prefix}page`)) || 1);
    if (search && params.has(`${prefix}q`)) search.value = params.get(`${prefix}q`);
    filters.forEach((f) => { if (params.has(`${prefix}${f.dataset.listFilter}`)) f.value = params.get(`${prefix}${f.dataset.listFilter}`); });
    const text = new Map(rows.map((r) => [r, r.innerText.toLowerCase()]));

    let noMatch = null;
    if (rows.length) {
      noMatch = document.createElement("tr");
      noMatch.dataset.noMatch = "";
      const td = document.createElement("td");
      td.colSpan = rows[0].children.length;
      td.className = "text-center text-muted";
      td.textContent = "No records match the filters";
      noMatch.append(td);
      noMatch.hidden = true;
      rows[rows.length - 1].after(noMatch);
    }

    function remember() {
      const p = new URLSearchParams(window.location.search);
      const put = (k, v, dflt) => (v && String(v) !== String(dflt) ? p.set(prefix + k, v) : p.delete(prefix + k));
      put("q", search?.value.trim(), "");
      filters.forEach((f) => put(f.dataset.listFilter, f.value, ""));
      put("page", page, 1);
      put("size", size, Number(list.dataset.pageSize) || 15);
      const qs = p.toString();
      history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    }

    function link(label, target, { disabled = false, active = false } = {}) {
      const el = document.createElement(active || disabled ? "span" : "a");
      el.className = `pagination-link${active ? " active" : ""}${disabled ? " disabled" : ""}`;
      el.textContent = label;
      if (!active && !disabled) {
        el.href = "#";
        el.addEventListener("click", (e) => { e.preventDefault(); page = target; render(); });
      }
      if (active) el.setAttribute("aria-current", "page");
      return el;
    }

    function render() {
      const q = search?.value.trim().toLowerCase() || "";
      const matches = rows.filter((r) =>
        (!q || text.get(r).includes(q)) &&
        filters.every((f) => !f.value || (r.dataset[f.dataset.listFilter.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? "") === f.value));
      const pages = Math.max(1, Math.ceil(matches.length / size));
      page = Math.min(page, pages);
      const from = (page - 1) * size;
      const shown = new Set(matches.slice(from, from + size));
      rows.forEach((r) => {
        const match = matches.includes(r);
        r.hidden = !shown.has(r);
        if (match && !shown.has(r)) r.dataset.paged = "1"; else delete r.dataset.paged; // export keeps these
      });
      if (emptyRow) emptyRow.hidden = rows.length > 0;
      if (noMatch) noMatch.hidden = matches.length > 0;
      if (count) {
        count.textContent = matches.length
          ? `Showing ${from + 1}–${Math.min(from + size, matches.length)} of ${matches.length}${matches.length !== rows.length ? ` (filtered from ${rows.length})` : ""}`
          : `0 of ${rows.length}`;
      }
      if (pager) {
        pager.replaceChildren();
        pager.className = "pagination flex w-full mt-3 no-print";
        const wrap = document.createElement("div");
        wrap.className = "flex flex-wrap justify-between w-full gap-2";
        const sizeBox = document.createElement("div");
        sizeBox.className = "flex items-center";
        sizeBox.innerHTML = '<span class="btn btn-outline rounded-r-none">Show</span>';
        const select = document.createElement("select");
        select.className = "select w-20 rounded-l-none border-l-0";
        select.setAttribute("aria-label", "Rows per page");
        PAGE_SIZES.forEach((n) => select.add(new Option(String(n), String(n), false, n === size)));
        select.addEventListener("change", () => { size = Number(select.value); page = 1; render(); });
        sizeBox.append(select);
        const nav = document.createElement("nav");
        nav.className = "flex items-center gap-1";
        nav.setAttribute("aria-label", "Pagination");
        nav.append(link("‹ Previous", page - 1, { disabled: page <= 1 }));
        const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
        let last = 0;
        for (const n of numbers) {
          if (n - last > 1) nav.append(link("…", n, { disabled: true }));
          nav.append(link(String(n), n, { active: n === page }));
          last = n;
        }
        nav.append(link("Next ›", page + 1, { disabled: page >= pages }));
        wrap.append(sizeBox, nav);
        pager.append(wrap);
        pager.hidden = rows.length <= PAGE_SIZES[0] && !q && filters.every((f) => !f.value);
      }
      remember();
    }

    let timer;
    search?.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; render(); }, 150); });
    filters.forEach((f) => f.addEventListener("change", () => { page = 1; render(); }));
    list.querySelector("[data-list-reset]")?.addEventListener("click", () => {
      if (search) search.value = "";
      filters.forEach((f) => { f.value = ""; });
      page = 1;
      render();
    });
    render();
  }
  document.querySelectorAll("[data-list]").forEach(setupList);

  document.querySelectorAll("[data-nav-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("[data-nav]")?.classList.toggle("hidden");
    });
  });

  // The rail picks which section the panel lists.
  const nav = document.querySelector("[data-nav]");
  if (nav) {
    const sections = [...nav.querySelectorAll("[data-nav-group]")];
    // The light/dark button sits in the rail but is not a menu section.
    const railItems = [...nav.querySelectorAll(".rail-item:not([data-theme-toggle])")];
    const showSection = (key) => {
      sections.forEach((section) => { section.hidden = section.dataset.navGroup !== key; });
      railItems.forEach((item) => {
        const active = (item.dataset.navSection ?? "home") === key;
        item.classList.toggle("active", active);
        if (item.tagName === "BUTTON") item.setAttribute("aria-pressed", String(active));
      });
    };
    railItems.filter((item) => item.tagName === "BUTTON").forEach((button) => {
      button.addEventListener("click", () => showSection(button.dataset.navSection));
    });
    showSection(nav.dataset.navActive);
  }

  // Theme: light, dark or the system setting. partials/head.xian applies the saved choice before first paint.
  const THEME_KEY = "xf-theme";
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const savedTheme = () => {
    try {
      return localStorage.getItem(THEME_KEY) || "dark";
    } catch {
      return "dark";
    }
  };
  const applyTheme = (choice) => {
    const dark = choice === "dark" || (choice === "system" && systemDark.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      const on = button.dataset.themeChoice === choice;
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
    });
  };
  XF.setTheme = (choice) => {
    try {
      localStorage.setItem(THEME_KEY, choice);
    } catch {
      // Storage can be blocked; the theme still applies to this page.
    }
    applyTheme(choice);
  };
  systemDark.addEventListener("change", () => {
    if (savedTheme() === "system") applyTheme("system");
  });
  // The sun/moon button flips between light and dark (Auto stays in the account menu).
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      XF.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
  });
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation(); // keeps the account menu open while choosing
      XF.setTheme(button.dataset.themeChoice);
    });
  });
  applyTheme(savedTheme());

  // Command palette: every page in the menu plus a few actions. Opens with Ctrl+K / Cmd+K, "/" or a search button.
  const panel = document.querySelector(".app-panel");
  if (panel) {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    document.querySelectorAll("[data-shortcut-label]").forEach((label) => { label.textContent = isMac ? "⌘K" : "Ctrl K"; });

    let overlay = null;
    let input = null;
    let list = null;
    let empty = null;
    let commands = [];
    let results = [];
    let active = 0;
    let returnFocus = null;

    const buildCommands = () => {
      const seen = new Set();
      const pages = [];
      // Dashboard shortcuts repeat links from other sections, so each page is listed once under its own section.
      panel.querySelectorAll("a[href]").forEach((link) => {
        if (link.closest("[data-nav-shortcuts]") || seen.has(link.href)) return;
        seen.add(link.href);
        const heading = link.closest("ul")?.previousElementSibling;
        pages.push({
          label: link.textContent.trim(),
          hint: heading?.classList.contains("nav-group") ? heading.textContent.trim() : "Action",
          run: () => { window.location.href = link.href; }
        });
      });
      const password = document.querySelector(".account-menu a[href]");
      const logout = document.querySelector("[data-logout]");
      return [
        ...pages,
        { label: "Use light theme", hint: "Appearance", run: () => XF.setTheme("light") },
        { label: "Use dark theme", hint: "Appearance", run: () => XF.setTheme("dark") },
        { label: "Match system theme", hint: "Appearance", run: () => XF.setTheme("system") },
        ...(password ? [{ label: password.textContent.trim(), hint: "Account", run: () => { window.location.href = password.href; } }] : []),
        ...(logout ? [{ label: "Log out", hint: "Account", run: () => logout.click() }] : [])
      ];
    };

    // Prefix matches rank first, then word starts, then anywhere, then letters in order ("tb" finds Trial Balance).
    const score = (label, term) => {
      const text = label.toLowerCase();
      if (text.startsWith(term)) return 4;
      if (text.split(/\s+/).some((word) => word.startsWith(term))) return 3;
      if (text.includes(term)) return 2;
      let matched = 0;
      for (const char of text) if (char === term[matched]) matched += 1;
      return matched === term.length ? 1 : 0;
    };

    const select = (index) => {
      if (!results.length) {
        input.removeAttribute("aria-activedescendant");
        return;
      }
      active = (index + results.length) % results.length;
      [...list.children].forEach((item, i) => item.setAttribute("aria-selected", String(i === active)));
      input.setAttribute("aria-activedescendant", list.children[active].id);
      list.children[active].scrollIntoView({ block: "nearest" });
    };

    const close = () => {
      overlay.hidden = true;
      returnFocus?.focus?.();
    };

    const choose = (index) => {
      const command = results[index];
      if (!command) return;
      close();
      command.run();
    };

    const render = () => {
      const term = input.value.trim().toLowerCase();
      results = term
        ? commands.map((command) => ({ command, rank: score(command.label, term) }))
          .filter((match) => match.rank > 0)
          .sort((a, b) => b.rank - a.rank)
          .map((match) => match.command)
        : commands;
      list.replaceChildren(...results.map((command, index) => {
        const item = document.createElement("li");
        item.id = `palette-option-${index}`;
        item.className = "palette-item";
        item.setAttribute("role", "option");
        const label = document.createElement("span");
        label.textContent = command.label;
        const hint = document.createElement("span");
        hint.textContent = command.hint;
        item.append(label, hint);
        item.addEventListener("mousemove", () => { if (active !== index) select(index); });
        item.addEventListener("click", () => choose(index));
        return item;
      }));
      empty.hidden = results.length > 0;
      select(0);
    };

    const create = () => {
      overlay = document.createElement("div");
      overlay.className = "palette-overlay";
      overlay.hidden = true;
      overlay.innerHTML = `
        <div class="palette" role="dialog" aria-modal="true" aria-label="Go to a page or action">
          <div class="palette-input">
            <svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
              placeholder="Search pages and actions" autocomplete="off" spellcheck="false">
            <kbd>Esc</kbd>
          </div>
          <ul class="palette-list" id="palette-list" role="listbox" aria-label="Results"></ul>
          <p class="palette-empty" hidden>Nothing matches your search</p>
          <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span></div>
        </div>`;
      document.body.appendChild(overlay);
      input = overlay.querySelector("input");
      list = overlay.querySelector(".palette-list");
      empty = overlay.querySelector(".palette-empty");
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
      input.addEventListener("input", render);
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          select(active + (e.key === "ArrowDown" ? 1 : -1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          choose(active);
        } else if (e.key === "Escape") {
          e.preventDefault();
          close();
        } else if (e.key === "Tab") {
          e.preventDefault(); // focus stays in the palette while it is open
        }
      });
    };

    const open = () => {
      if (!overlay) create();
      commands = buildCommands();
      returnFocus = document.activeElement;
      overlay.hidden = false;
      input.value = "";
      render();
      input.focus();
    };

    document.addEventListener("keydown", (e) => {
      const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (overlay && !overlay.hidden) close();
        else open();
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        open();
      }
    });
    document.querySelectorAll("[data-palette-open]").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        open();
      });
    });
  }

  // Installable app: the service worker caches static files and shows an offline page (see public/sw.js).
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  window.XF = XF;
})();
