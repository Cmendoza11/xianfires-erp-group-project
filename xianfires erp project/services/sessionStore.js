import session from "express-session";
import { Op } from "sequelize";
import { AdminSession } from "../models/AdminSession.js";

const DEFAULT_TTL_MS = 30 * 60_000;
const PRUNE_EVERY_MS = 15 * 60_000;

// express-session store backed by the admin_session table (no extra package). The table is created on
// first use, so a database that has not run `npm run migrate` yet still works.
export class MySqlSessionStore extends session.Store {
  constructor() {
    super();
    this.ready = null;
    const timer = setInterval(() => this.prune().catch(() => {}), PRUNE_EVERY_MS);
    timer.unref();
  }

  ensureTable() {
    if (!this.ready) this.ready = AdminSession.sync().catch((err) => { this.ready = null; throw err; });
    return this.ready;
  }

  static expiresOf(sess) {
    const expires = sess?.cookie?.expires;
    return expires ? new Date(expires) : new Date(Date.now() + DEFAULT_TTL_MS);
  }

  get(sid, cb = () => {}) {
    this.ensureTable()
      .then(() => AdminSession.findByPk(sid))
      .then((row) => {
        if (!row || row.expires < new Date()) return cb(null, null);
        try {
          cb(null, JSON.parse(row.data));
        } catch {
          cb(null, null); // a damaged row is treated as no session
        }
      })
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    this.ensureTable()
      .then(() => AdminSession.upsert({ sid, data: JSON.stringify(sess), expires: MySqlSessionStore.expiresOf(sess) }))
      .then(() => cb(null))
      .catch(cb);
  }

  touch(sid, sess, cb = () => {}) {
    this.ensureTable()
      .then(() => AdminSession.update({ expires: MySqlSessionStore.expiresOf(sess) }, { where: { sid } }))
      .then(() => cb(null))
      .catch(cb);
  }

  destroy(sid, cb = () => {}) {
    this.ensureTable()
      .then(() => AdminSession.destroy({ where: { sid } }))
      .then(() => cb(null))
      .catch(cb);
  }

  prune() {
    return this.ensureTable().then(() => AdminSession.destroy({ where: { expires: { [Op.lt]: new Date() } } }));
  }
}
