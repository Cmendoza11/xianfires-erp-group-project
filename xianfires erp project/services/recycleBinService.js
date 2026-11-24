// Recycle Bin: soft-deleted master data (accounts, customers, suppliers, users, fixed assets).
// Restoring puts the record back exactly as it was.
import { Op } from "sequelize";
import { Account, AdminUser, Contact, FixedAsset } from "../models/index.js";
import { urls } from "../routes/urls.js";
import { UUID_PATTERN } from "./accountService.js";
import { AccountingValidationError } from "./accountTypes.js";
import { restoreFixedAsset } from "./fixedAssetService.js";

export const BIN_KINDS = {
  account: { label: "Account", model: Account, describe: (r) => `${r.code} - ${r.name}` },
  contact: { label: "Customer / supplier", model: Contact, describe: (r) => `${r.name} (${r.type})` },
  user: { label: "User", model: AdminUser, describe: (r) => `${r.full_name || r.email} <${r.email}>` },
  asset: { label: "Fixed asset", model: FixedAsset, describe: (r) => r.name }
};

export async function listDeleted() {
  const items = [];
  for (const [kind, info] of Object.entries(BIN_KINDS)) {
    const rows = await info.model.findAll({ where: { deleted_at: { [Op.ne]: null } }, paranoid: false, raw: true });
    for (const row of rows) {
      items.push({
        kind,
        kindLabel: info.label,
        uuid: row.uuid,
        label: info.describe(row),
        deletedAt: row.deleted_at,
        restoreApi: urls.restoreDeleted(kind, row.uuid)
      });
    }
  }
  return items.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
}

export async function restoreDeleted(kind, uuid, adminUserId) {
  const info = BIN_KINDS[kind];
  if (!info || !UUID_PATTERN.test(String(uuid ?? ""))) throw new AccountingValidationError("Record not found");
  if (kind === "asset") {
    const asset = await restoreFixedAsset(uuid, adminUserId);
    return { kind, label: asset.name };
  }
  const row = await info.model.findOne({ where: { uuid }, paranoid: false });
  if (!row || !row.deleted_at) throw new AccountingValidationError("This record is not in the Recycle Bin");
  await row.restore();
  return { kind, label: info.describe(row.get({ plain: true })) };
}
