'use strict';
const { pool } = require('../db/database');

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return fwd ? fwd.split(',')[0].trim() : req.ip;
}

async function writeAuditLog({ userId, userEmail, action, resourceType, resourceId, ipAddress, userAgent, details }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id,user_email,action,resource_type,resource_id,ip_address,user_agent,details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId||null, userEmail||null, action, resourceType||null, resourceId||null,
       ipAddress||null, userAgent||null, details ? JSON.stringify(details) : null]
    );
  } catch(e) { console.error('Audit log write failed:', e.message); }
}

module.exports = { writeAuditLog, getClientIp };
