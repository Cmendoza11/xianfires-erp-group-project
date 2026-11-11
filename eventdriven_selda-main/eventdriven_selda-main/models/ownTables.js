// Procurement's own tables, read from its models. Reset/seed scripts use this list so they can never
// truncate another ERP module's tables in the shared database (HR, POS, Accounting, Customer Logs).
export function ownTables(sequelize) {
  const names = [...new Set(Object.values(sequelize.models).map((model) => {
    const table = model.getTableName();
    return typeof table === "string" ? table : table.tableName;
  }))];
  const foreign = names.filter((name) => !name.startsWith("scm_"));
  if (foreign.length) {
    throw new Error(`Refusing to touch tables outside Procurement (scm_*): ${foreign.join(", ")}`);
  }
  return names;
}
