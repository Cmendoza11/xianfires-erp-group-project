/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines
*/
import { Sequelize } from 'sequelize';

// Central DJ's ERP database (shared with the other modules; Procurement tables use the scm_ prefix).
const dbName = process.env.DB_NAME || 'djs_procurement';
const dbUser = process.env.DB_USER || 'root';
const dbPass = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '';
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || 3306;

export const sequelize = new Sequelize(dbName, dbUser, dbPass, {
    host: dbHost,
    port: dbPort,
    dialect: 'mysql',
    logging: false,
    // Stored in UTC like the other ERP modules; local (PH) dates are worked out in JavaScript.
    pool: {
        max: 15,
        min: 0,
        acquire: 30000,
        idle: 10000
    },
    define: {
        timestamps: true,
        underscored: false,
        freezeTableName: false
    }
});
