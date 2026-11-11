// `npm run migrate` now runs the safe migration. The old version ran `sync({ force: true })`, which
// would drop tables in the central database that the other DJ's ERP modules share.
import "./safe-migrate.js";
