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
        let ip = req.headers['x-forwarded-for'] 
            || req.headers['x-real-ip']
            || req.headers['cf-connecting-ip']
            || req.ip 
            || req.socket?.remoteAddress 
            || req.connection?.remoteAddress 
            || null;

        if (ip && typeof ip === 'string') {
            // If comma-separated (proxy chain), take the first client IP
            if (ip.includes(',')) {
                ip = ip.split(',')[0].trim();
            }
            // Convert IPv6 loopback to standard IPv4
            if (ip === '::1' || ip === '::ffff:127.0.0.1') {
                return '127.0.0.1';
            }
            // Strip IPv4-mapped IPv6 prefix
            if (ip.startsWith('::ffff:')) {
                ip = ip.substring(7);
            }
        }
        return ip;
    }

    /**
     * Helper to get user agent from request
     */
    getUserAgent(req) {
        return req.headers['user-agent'] || null;
    }
}

module.exports = new AuditService();