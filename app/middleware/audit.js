const { pool } = require('../db/database');

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
}

async function writeAuditLog(req, action, resourceType = null, resourceId = null, details = {}) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, user_email, action, resource_type, resource_id, ip_address, user_agent, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.user?.id || null, req.user?.email || null, action, resourceType, resourceId,
       getClientIp(req), req.headers['user-agent'] || null, JSON.stringify(details)]);
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { writeAuditLog, getClientIp };
