import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { logAudit } from "../services/auditService.js";
import { listDeleted, restoreDeleted } from "../services/recycleBinService.js";

export const recycleBinPage = async (req, res) => {
  res.render("recycleBin", { title: "Recycle Bin", activeMenu: "recycleBin", urls, items: await listDeleted() });
};

export const restoreRecord = async (req, res) => {
  try {
    const result = await restoreDeleted(req.params.kind, req.params.id, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "recycle.restore",
      entityType: req.params.kind,
      entityId: req.params.id,
      summary: `Restored ${result.label} from the Recycle Bin`
    });
    res.json({ data: result });
  } catch (e) {
    if (e instanceof AccountingValidationError) {
      return res.status(400).json({ error: { status: 400, message: e.message } });
    }
    throw e;
  }
};
