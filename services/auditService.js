// backend/services/auditService.js
const AdminActionLog = require('../models/AdminActionLog');

class AuditService {
    /**
     * Log an admin action
     */
    async log({
        actor,
        actorRole,
        actorEmail,
        action,
        entityType,
        entityId,
        description,
        before = null,
        after = null,
        notes = null,
        ipAddress = null,
        userAgent = null
    }) {
        try {
            const log = await AdminActionLog.create({
                actor,
                actorRole,
                actorEmail,
                action,
                entityType,
                entityId,
                description,
                before,
                after,
                notes,
                ipAddress,
                userAgent
            });

            console.log(`[AUDIT] ${actorRole}:${actorEmail} → ${action} on ${entityType}:${entityId}`);
            return log;
        } catch (error) {
            // Never break main flow due to audit failure
            console.error('[AUDIT] Log failed:', error.message);
            return null;
        }
    }

    /**
     * Helper to get IP from request
     */
    getIp(req) {
        return req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || null;
    }

    /**
     * Helper to get user agent from request
     */
    getUserAgent(req) {
        return req.headers['user-agent'] || null;
    }
}

module.exports = new AuditService();