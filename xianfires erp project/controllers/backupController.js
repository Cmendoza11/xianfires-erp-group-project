import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { logAudit } from "../services/auditService.js";
import { backupFile, createBackup, deleteBackup, listBackups, restoreBackup } from "../services/backupService.js";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

export const backupPage = async (req, res) => {
  res.render("backups", {
    title: "Backup and Restore",
    activeMenu: "backups",
    urls,
    backups: listBackups().map((b) => ({
      ...b,
      downloadUrl: urls.backupDownload(b.name),
      restoreApi: urls.backupRestoreApi(b.name),
      deleteApi: urls.backupDeleteApi(b.name)
    }))
  });
};

export const createBackupApi = async (req, res) => {
  try {
    const backup = await createBackup();
    await logAudit(req, { action: "backup.create", entityType: "backup", entityId: null, details: { file: backup.name }, summary: `Made backup ${backup.name} (${backup.sizeLabel})` });
    res.json({ data: { name: backup.name, size: backup.sizeLabel } });
  } catch (e) {
    sendError(res, e);
  }
};

export const downloadBackup = async (req, res, next) => {
  let file;
  try {
    file = backupFile(req.params.name);
  } catch {
    return next(); // 404 page
  }
  await logAudit(req, { action: "backup.download", entityType: "backup", entityId: null, details: { file: req.params.name }, summary: `Downloaded backup ${req.params.name}` });
  res.download(file, req.params.name);
};

export const restoreBackupApi = async (req, res) => {
  try {
    const result = await restoreBackup(req.params.name, req.body?.confirm);
    await logAudit(req, {
      action: "backup.restore",
      entityType: "backup",
      entityId: null,
      summary: `Restored the books from ${result.restored} (safety copy ${result.safetyCopy})`,
      details: result
    });
    res.json({ data: result });
  } catch (e) {
    sendError(res, e);
  }
};

export const deleteBackupApi = async (req, res) => {
  try {
    deleteBackup(req.params.name);
    await logAudit(req, { action: "backup.delete", entityType: "backup", entityId: null, details: { file: req.params.name }, summary: `Deleted backup ${req.params.name}` });
    res.json({ data: { deleted: req.params.name } });
  } catch (e) {
    sendError(res, e);
  }
};
