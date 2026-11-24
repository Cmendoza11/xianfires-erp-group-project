(function () {
  // Search, type/status filters and pages are handled by the shared [data-list] tool in admin.js.

  document.querySelectorAll("[data-delete-account]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await XF.confirm({
        heading: `Delete account ${button.dataset.code}`,
        content: `${button.dataset.name} will be moved to the Recycle Bin. An administrator can restore it.`
      });
      if (!confirmed) return;
      const result = await XF.api("DELETE", button.dataset.deleteAccount);
      if (result.ok) {
        await XF.alert({ type: "success", title: "Account moved to the Recycle Bin", autoClose: 900 });
        window.location.reload();
      } else {
        XF.alert({ type: "error", title: "Not deleted", message: XF.errorMessage(result, "Unable to delete account") });
      }
    });
  });
})();
