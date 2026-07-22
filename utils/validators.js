// utils/validators.js
const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const validateMobile = (mobile) => {
    const cleaned = mobile.replace(/\D/g, '');
    return cleaned.length === 10;
};

const validateGST = (gst) => {
    const re = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return re.test(gst);
};

const validatePAN = (pan) => {
    const re = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    return re.test(pan);
};

const net = require('net');

/**
 * Validates a resume URL to prevent SSRF (Server-Side Request Forgery).
 * Rejects:
 * - Non-HTTP/HTTPS protocols
 * - Localhost / Loopback addresses (127.0.0.1, ::1, localhost, *.local)
 * - AWS/Cloud metadata endpoints (169.254.169.254, 169.254.*.*)
 * - Private RFC 1918 IPv4 ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
 * - Carrier-grade NAT (100.64-127.x.x)
 * - Link-local & Multicast addresses
 */
const validateResumeUrl = (urlStr) => {
    if (!urlStr || typeof urlStr !== 'string') {
        return { valid: false, reason: 'URL must be a non-empty string' };
    }

    let parsed;
    try {
        parsed = new URL(urlStr.trim());
    } catch (e) {
        return { valid: false, reason: 'Invalid URL format' };
    }

    // 1. Protocol must be http or https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, reason: 'Only HTTP and HTTPS protocols are allowed' };
    }

    const hostname = parsed.hostname.toLowerCase().trim();

    // 2. Reject localhost / loopback names
    if (
        hostname === 'localhost' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.localhost') ||
        hostname === '0.0.0.0'
    ) {
        return { valid: false, reason: 'Access to localhost/internal domains is restricted' };
    }

    // 3. Check if hostname is an IP address
    const ipType = net.isIP(hostname);
    if (ipType === 4) {
        const parts = hostname.split('.').map(Number);
        const [a, b, c, d] = parts;

        // Loopback (127.0.0.0/8)
        if (a === 127) return { valid: false, reason: 'Access to loopback IP is restricted' };

        // Private RFC 1918
        if (a === 10) return { valid: false, reason: 'Access to private network IP is restricted' };
        if (a === 172 && b >= 16 && b <= 31) return { valid: false, reason: 'Access to private network IP is restricted' };
        if (a === 192 && b === 168) return { valid: false, reason: 'Access to private network IP is restricted' };

        // Cloud Metadata / Link-Local (169.254.0.0/16)
        if (a === 169 && b === 254) return { valid: false, reason: 'Access to cloud metadata IP is restricted' };

        // Carrier-Grade NAT (100.64.0.0/10)
        if (a === 100 && b >= 64 && b <= 127) return { valid: false, reason: 'Access to CGNAT IP is restricted' };

        // Current network / Broadcast
        if (a === 0 || a >= 224) return { valid: false, reason: 'Access to multicast/broadcast IP is restricted' };
    } else if (ipType === 6) {
        // IPv6 Loopback / Link-local / Unique-local
        if (
            hostname === '::1' ||
            hostname.startsWith('fe80:') ||
            hostname.startsWith('fd') ||
            hostname.startsWith('fc')
        ) {
            return { valid: false, reason: 'Access to private IPv6 address is restricted' };
        }
    }

    return { valid: true };
};

module.exports = { validateEmail, validateMobile, validateGST, validatePAN, validateResumeUrl };




