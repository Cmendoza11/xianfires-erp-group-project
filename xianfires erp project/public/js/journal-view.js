(function () {
  const button = document.querySelector("[data-delete-entry]");
  if (button) {
    button.addEventListener("click", async () => {
      const confirmed = await XF.confirm({
        heading: `Delete ${button.dataset.entryNumber}`,
        content: "This permanently removes the entry and its lines from the ledger."
      });
      if (!confirmed) return;
      const result = await XF.api("DELETE", button.dataset.deleteEntry);
      if (result.ok) {
        window.location.href = button.dataset.gridUrl;
      } else {
        XF.toast("error", XF.errorMessage(result, "Unable to delete journal entry"));
      }
    });
  }

  // Reverse entry is a modal form now; admin.js asks to confirm and shows the result.
})();
