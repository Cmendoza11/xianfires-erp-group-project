import { Customer } from "./customer.js";
import { CustomerLog } from "./customerLog.js";
import { PromoRedemption } from "./promoRedemption.js";
import { LoyaltyRecord } from "./loyaltyRecord.js";
import { User } from "./userModel.js";
import { Promo } from "./promo.js";

Customer.hasMany(CustomerLog, { foreignKey: "customerId" });
CustomerLog.belongsTo(Customer, { foreignKey: "customerId" });
Customer.hasMany(PromoRedemption, { foreignKey: "customerId" });
PromoRedemption.belongsTo(Customer, { foreignKey: "customerId" });
Promo.hasMany(PromoRedemption, { foreignKey: "promoId" });
PromoRedemption.belongsTo(Promo, { foreignKey: "promoId" });
User.hasMany(PromoRedemption, { foreignKey: "recordedByUserId" });
PromoRedemption.belongsTo(User, { foreignKey: "recordedByUserId" });
Customer.hasOne(LoyaltyRecord, { foreignKey: "customerId" });
LoyaltyRecord.belongsTo(Customer, { foreignKey: "customerId" });
User.hasMany(CustomerLog, { foreignKey: "recordedByUserId" });
CustomerLog.belongsTo(User, { foreignKey: "recordedByUserId" });

export { Customer, CustomerLog, PromoRedemption, LoyaltyRecord, Promo };
