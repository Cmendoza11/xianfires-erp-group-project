import { urls } from "../routes/urls.js";
import { AccountingValidationError } from "../services/accountTypes.js";
import { logAudit } from "../services/auditService.js";
import { today } from "../services/dateUtils.js";
import {
  cashAccountOptions,
  createFixedAsset as createRecord,
  deleteFixedAsset as deleteRecord,
  updateFixedAsset as updateRecord,
  listDepreciationRuns,
  listFixedAssets,
  runDepreciation,
  suggestedDepreciationMonth,
  undoLatestDepreciation
} from "../services/fixedAssetService.js";

function sendError(res, e) {
  if (e instanceof AccountingValidationError) {
    return res.status(400).json({ error: { status: 400, message: e.message } });
  }
  throw e;
}

export const fixedAssetGrid = async (req, res) => {
  res.render("fixedAssetGrid", {
    title: "Fixed Assets",
    activeMenu: "fixedAssets",
    urls,
    assets: await listFixedAssets(),
    runs: await listDepreciationRuns(),
    cashAccounts: await cashAccountOptions(),
    suggestedMonth: await suggestedDepreciationMonth(),
    currentMonth: today().slice(0, 7),
    today: today()
  });
};

export const createFixedAsset = async (req, res) => {
  try {
    const asset = await createRecord(req.body, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "asset.create",
      entityType: "fixed_asset",
      entityId: asset.uuid,
      summary: `Added fixed asset ${asset.name} (${asset.cost.toFixed(2)})${asset.posted ? " and posted its purchase" : ""}`
    });
    res.json({ data: asset });
  } catch (e) {
    sendError(res, e);
  }
};

export const depreciateMonth = async (req, res) => {
  try {
    const run = await runDepreciation(req.body, req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "asset.depreciate",
      entityType: "fixed_asset_depreciation",
      entityId: run.month,
      summary: `Ran depreciation for ${run.label}: ${run.total.toFixed(2)} on ${run.assets} asset(s)`
    });
    res.json({ data: run });
  } catch (e) {
    sendError(res, e);
  }
};

export const undoDepreciation = async (req, res) => {
  try {
    const run = await undoLatestDepreciation(req.adminUser?.admin_user_id);
    await logAudit(req, {
      action: "asset.undo_depreciation",
      entityType: "fixed_asset_depreciation",
      entityId: run.month,
      summary: `Undid depreciation for ${run.label}`
    });
    res.json({ data: run });
  } catch (e) {
    sendError(res, e);
  }
};

export const updateFixedAsset = async (req, res) => {
  try {
    const asset = await updateRecord(req.params.id, req.body);
    await logAudit(req, { action: "asset.update", entityType: "fixed_asset", entityId: asset.uuid, summary: `Edited fixed asset ${asset.name}` });
    res.json({ data: asset });
  } catch (e) {
    sendError(res, e);
  }
};

export const deleteFixedAsset = async (req, res) => {
  try {
    const asset = await deleteRecord(req.params.id, req.adminUser?.admin_user_id);
    await logAudit(req, { action: "asset.delete", entityType: "fixed_asset", entityId: asset.uuid, summary: `Moved fixed asset ${asset.name} to the Recycle Bin` });
    res.json({ data: asset });
  } catch (e) {
    sendError(res, e);
  }
};
