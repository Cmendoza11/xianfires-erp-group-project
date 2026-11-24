import session from "express-session";
import { Op } from "sequelize";
import { PosSession } from "../models/index.js";

export const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const expiryOf = (data) => new Date(data.cookie.expires ?? Date.now() + SESSION_MAX_AGE);

export class PosSessionStore extends session.Store {
  get(id, callback) {
    PosSession.findOne({ where: { id, expiresAt: { [Op.gt]: new Date() } } })
      .then((row) => callback(null, row?.data), callback);
  }

  set(id, data, callback) {
    PosSession.upsert({ id, data, expiresAt: expiryOf(data) })
      .then(() => callback(), callback);
  }

  touch(id, data, callback) {
    PosSession.update({ expiresAt: expiryOf(data) }, {
      where: { id, expiresAt: { [Op.gt]: new Date() } },
    }).then(() => callback(), callback);
  }

  destroy(id, callback) {
    PosSession.destroy({ where: { id } })
      .then(() => callback(), callback);
  }

  pruneExpired() {
    return PosSession.destroy({ where: { expiresAt: { [Op.lte]: new Date() } } });
  }
}
