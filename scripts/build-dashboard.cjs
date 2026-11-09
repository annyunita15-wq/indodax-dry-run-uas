'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const auditPath = path.join(root, 'data', 'audit-export.json');
const metricsPath = path.join(root, 'data', 'recalculated.json');
const audit = fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath, 'utf8')) : {
	state: null, calls: [], orders: [], trades: [], snapshots: [], errors: [], switches: [], backtest: null
};
const metrics = fs.existsSync(metricsPath) ? JSON.parse(fs.readFileSync(metricsPath, 'utf8')) : {};
if (!metrics.benchmark && audit.backtest?.benchmark) metrics.benchmark = audit.backtest.benchmark;
const payload = JSON.stringify({ ...audit, metrics }).replace(/</g, '\\u003c');
if (!template.includes('window.AUDIT_DATA = null;')) throw new Error('Penanda data offline tidak ditemukan di index.html.');
fs.writeFileSync(path.join(root, 'dashboard-offline.html'), template.replace('window.AUDIT_DATA = null;', `window.AUDIT_DATA = ${payload};`));
console.log('Dashboard offline mandiri dibuat: dashboard-offline.html');