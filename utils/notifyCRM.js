// Syncro1_Backend/utils/notifyCRM.js
// Fire-and-forget CRM notifier
// NEVER blocks the main platform flow
// If CRM is down → main platform still works perfectly

const http = require('http')

const CRM_HOST = 'localhost'
const CRM_PORT = 5001
const CRM_PATH = '/api/crm/capture'
const TIMEOUT_MS = 3000

/**
 * notifyCRM(payload)
 * 
 * Sends lead lifecycle event to CRM.
 * Always fire-and-forget — never await this.
 * 
 * @param {object} payload
 * @param {string} payload.type           - 'STAFFING_PARTNER' | 'COMPANY'
 * @param {string} payload.email          - user email
 * @param {string} payload.phone          - user mobile
 * @param {string} payload.name           - full name
 * @param {string} payload.company        - firm/company name
 * @param {string} payload.channel        - source channel
 * @param {string} payload.crmStatus      - CRM status to set
 * @param {string} payload.crmSubStatus   - CRM sub-status to set
 * @param {object} payload.profileCompletion - section completion map
 * @param {number} payload.profilePercent - 0-100
 * @param {object} payload.journeyEvent   - event details
 * @param {object} payload.platformRef    - platform entity reference
 */
const notifyCRM = (payload) => {
    // Use setImmediate so registration response
    // is sent to user BEFORE this runs
    setImmediate(() => {
        try {
            const body = JSON.stringify(payload)

            const options = {
                hostname: CRM_HOST,
                port: CRM_PORT,
                path: CRM_PATH,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'x-internal-source': 'syncro1-platform'
                },
                timeout: TIMEOUT_MS
            }

            const req = http.request(options, (res) => {
                // Must consume response to free the socket
                res.resume()

                if (res.statusCode === 200 || res.statusCode === 201) {
                    console.log(
                        `[CRM] ✅ ${payload.crmSubStatus || payload.channel} — ` +
                        `${payload.type} | ${payload.email || payload.phone || 'unknown'}`
                    )
                } else {
                    console.warn(
                        `[CRM] ⚠️ HTTP ${res.statusCode} — ` +
                        `${payload.email || payload.phone || 'unknown'}`
                    )
                }
            })

            req.on('timeout', () => {
                console.warn('[CRM] ⚠️ Timeout (non-critical)')
                req.destroy()
            })

            req.on('error', (err) => {
                // Silent — CRM being down must never affect platform
                console.warn(`[CRM] ⚠️ Failed (non-critical): ${err.message}`)
            })

            req.write(body)
            req.end()

        } catch (err) {
            console.warn(`[CRM] ⚠️ Notify error (non-critical): ${err.message}`)
        }
    })
}

// ─────────────────────────────────────────────────────────
// HELPER: Calculate profile completion % from sections map
// ─────────────────────────────────────────────────────────

const calcProfilePercent = (profileCompletion = {}) => {
    if (!profileCompletion || typeof profileCompletion !== 'object') return 0
    const keys = Object.keys(profileCompletion).filter(
        k => !k.startsWith('$') && k !== '_id' && k !== 'id' && k !== '__v'
    )
    if (keys.length === 0) return 0
    const completed = keys.filter(k => !!profileCompletion[k]).length
    return Math.round((completed / keys.length) * 100)
}
// ─────────────────────────────────────────────────────────
// PARTNER LIFECYCLE EVENTS
// ─────────────────────────────────────────────────────────

/**
 * Partner just registered
 */
notifyCRM.partnerRegistered = (user, partner) => {
    notifyCRM({
        name: `${partner.firstName} ${partner.lastName}`,
        email: user.email,
        phone: user.mobile,
        whatsapp: user.mobile,
        company: partner.firmName,
        designation: partner.designation || null,
        city: partner.city || null,
        state: partner.state || null,
        type: 'STAFFING_PARTNER',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'NEW',
        crmSubStatus: 'JUST_REGISTERED',
        profileCompletion: {
            basicInfo: true,
            firmDetails: false,
            Syncro1Competency: false,
            geographicReach: false,
            compliance: false,
            commercialDetails: false,
            documents: false
        },
        profilePercent: 14
    })
}

/**
 * Partner email verified
 */
notifyCRM.partnerEmailVerified = (user) => {
    notifyCRM({
        email: user.email,
        phone: user.mobile,
        type: 'STAFFING_PARTNER',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'NEW',
        crmSubStatus: 'EMAIL_VERIFIED',
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: 'Email verified',
            data: { userId: user._id.toString() }
        }
    })
}

/**
 * Partner mobile verified (both verified = fully verified)
 */
notifyCRM.partnerMobileVerified = (user) => {
    notifyCRM({
        email: user.email,
        phone: user.mobile,
        type: 'STAFFING_PARTNER',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'NEW',
        crmSubStatus: 'FULLY_VERIFIED',
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: 'Mobile verified — account fully verified',
            data: { userId: user._id.toString() }
        }
    })
}

/**
 * Partner profile section saved
 * @param {object} user
 * @param {object} partner - full partner document
 */
notifyCRM.partnerProfileStep = (user, partner) => {
    const rawCompletion = partner.profileCompletion
        ? partner.profileCompletion.toObject
            ? partner.profileCompletion.toObject()
            : { ...partner.profileCompletion }
        : {}
    const profileCompletion = {}
    Object.keys(rawCompletion).forEach(k => {
        if (!k.startsWith('$') && k !== '_id' && k !== 'id' && k !== '__v') {
            profileCompletion[k] = rawCompletion[k]
        }
    })

    const profilePercent = calcProfilePercent(profileCompletion)
    const completedSections = Object.keys(profileCompletion).filter(k => !!profileCompletion[k])

    let crmSubStatus = 'PROFILE_FILLING'
    if (profileCompletion.basicInfo && completedSections.length === 1) {
        crmSubStatus = 'BASIC_INFO_DONE'
    } else if (profileCompletion.compliance) {
        crmSubStatus = 'AGREEMENT_SIGNED'
    } else if (profilePercent === 100) {
        crmSubStatus = 'PROFILE_COMPLETE'
    }

    notifyCRM({
        email: user.email,
        phone: user.mobile,
        company: partner.firmName,
        type: 'STAFFING_PARTNER',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'IN_PROGRESS',
        crmSubStatus,
        profileCompletion,
        profilePercent,
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: `Profile step saved — ${profilePercent}% complete`,
            data: {
                userId: user._id.toString(),
                completedSections,
                profilePercent
            }
        }
    })
}

/**
 * Partner profile submitted for review
 */
notifyCRM.partnerProfileSubmitted = (user, partner) => {
    const rawCompletion = partner.profileCompletion
        ? partner.profileCompletion.toObject
            ? partner.profileCompletion.toObject()
            : { ...partner.profileCompletion }
        : {}
    const profileCompletion = {}
    Object.keys(rawCompletion).forEach(k => {
        if (!k.startsWith('$') && k !== '_id' && k !== 'id' && k !== '__v') {
            profileCompletion[k] = rawCompletion[k]
        }
    })

    notifyCRM({
        email: user.email,
        phone: user.mobile,
        company: partner.firmName,
        type: 'STAFFING_PARTNER',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'SUBMITTED',
        crmSubStatus: 'UNDER_REVIEW',
        profileCompletion,
        profilePercent: 100,
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: 'Profile submitted for admin review',
            data: {
                userId: user._id.toString(),
                partnerId: partner._id.toString()
            }
        }
    })
}

/**
 * Partner approved by admin
 */
notifyCRM.partnerApproved = (user, partner) => {
    notifyCRM({
        email: user.email,
        phone: user.mobile,
        company: partner.firmName,
        type: 'STAFFING_PARTNER',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'CONVERTED',
        crmSubStatus: 'ACTIVE_PARTNER',
        profilePercent: 100,
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: 'Talent Partner approved — now active on platform',
            data: {
                userId: user._id.toString(),
                partnerId: partner._id.toString()
            }
        },
        platformRef: {
            type: 'StaffingPartner',
            entityId: partner._id.toString(),
            userId: user._id.toString()
        }
    })
}

/**
 * Partner rejected by admin
 */
notifyCRM.partnerRejected = (user, partner, reason) => {
    notifyCRM({
        email: user.email,
        phone: user.mobile,
        company: partner.firmName,
        type: 'STAFFING_PARTNER',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'LOST',
        crmSubStatus: 'REJECTED',
        journeyEvent: {
            type: 'STATUS_CHANGED',
            channel: 'PLATFORM_REGISTRATION',
            description: `Partner rejected: ${reason || 'No reason provided'}`,
            data: {
                userId: user._id.toString(),
                partnerId: partner._id.toString(),
                reason: reason || null
            }
        }
    })
}

// ─────────────────────────────────────────────────────────
// COMPANY LIFECYCLE EVENTS
// ─────────────────────────────────────────────────────────

/**
 * Company just registered
 */
notifyCRM.companyRegistered = (user, company) => {
    notifyCRM({
        name: company.decisionMakerName,
        email: user.email,
        phone: user.mobile,
        whatsapp: user.mobile,
        company: company.companyName,
        designation: company.designation || null,
        city: company.city || null,
        state: company.state || null,
        type: 'COMPANY',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'NEW',
        crmSubStatus: 'JUST_REGISTERED',
        profileCompletion: {
            basicInfo: true,
            kyc: false,
            hiringPreferences: false,
            billing: false,
            legalConsents: false,
            documents: false
        },
        profilePercent: 17
    })
}

/**
 * Company email verified
 */
notifyCRM.companyEmailVerified = (user) => {
    notifyCRM({
        email: user.email,
        phone: user.mobile,
        type: 'COMPANY',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'NEW',
        crmSubStatus: 'EMAIL_VERIFIED',
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: 'Company email verified',
            data: { userId: user._id.toString() }
        }
    })
}

/**
 * Company mobile verified
 */
notifyCRM.companyMobileVerified = (user) => {
    notifyCRM({
        email: user.email,
        phone: user.mobile,
        type: 'COMPANY',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'NEW',
        crmSubStatus: 'FULLY_VERIFIED',
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: 'Company mobile verified — account fully verified',
            data: { userId: user._id.toString() }
        }
    })
}

/**
 * Company profile section saved
 * @param {object} user
 * @param {object} company - full company document
 */
notifyCRM.companyProfileStep = (user, company) => {
    const rawCompletion = company.profileCompletion
        ? company.profileCompletion.toObject
            ? company.profileCompletion.toObject()
            : { ...company.profileCompletion }
        : {}
    const profileCompletion = {}
    Object.keys(rawCompletion).forEach(k => {
        if (!k.startsWith('$') && k !== '_id' && k !== 'id' && k !== '__v') {
            profileCompletion[k] = rawCompletion[k]
        }
    })

    const profilePercent = calcProfilePercent(profileCompletion)
    const completedSections = Object.keys(profileCompletion).filter(k => !!profileCompletion[k])

    let crmSubStatus = 'PROFILE_FILLING'
    if (profileCompletion.basicInfo && completedSections.length === 1) {
        crmSubStatus = 'BASIC_INFO_DONE'
    } else if (profilePercent === 100) {
        crmSubStatus = 'PROFILE_COMPLETE'
    }

    notifyCRM({
        email: user.email,
        phone: user.mobile,
        company: company.companyName,
        type: 'COMPANY',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'IN_PROGRESS',
        crmSubStatus,
        profileCompletion,
        profilePercent,
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: `Company profile step saved — ${profilePercent}% complete`,
            data: {
                userId: user._id.toString(),
                completedSections,
                profilePercent
            }
        }
    })
}

/**
 * Company profile submitted for review
 */
notifyCRM.companyProfileSubmitted = (user, company) => {
    const rawCompletion = company.profileCompletion
        ? company.profileCompletion.toObject
            ? company.profileCompletion.toObject()
            : { ...company.profileCompletion }
        : {}
    const profileCompletion = {}
    Object.keys(rawCompletion).forEach(k => {
        if (!k.startsWith('$') && k !== '_id' && k !== 'id' && k !== '__v') {
            profileCompletion[k] = rawCompletion[k]
        }
    })
    notifyCRM({
        email: user.email,
        phone: user.mobile,
        company: company.companyName,
        type: 'COMPANY',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'SUBMITTED',
        crmSubStatus: 'UNDER_REVIEW',
        profileCompletion,
        profilePercent: 100,
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: 'Company profile submitted for admin review',
            data: {
                userId: user._id.toString(),
                companyId: company._id.toString()
            }
        }
    })
}

/**
 * Company approved by admin
 */
notifyCRM.companyApproved = (user, company) => {
    notifyCRM({
        email: user.email,
        phone: user.mobile,
        company: company.companyName,
        type: 'COMPANY',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'CONVERTED',
        crmSubStatus: 'ACTIVE_COMPANY',
        profilePercent: 100,
        journeyEvent: {
            type: 'PROFILE_COMPLETED',
            channel: 'PLATFORM_REGISTRATION',
            description: 'Company approved — now active on platform',
            data: {
                userId: user._id.toString(),
                companyId: company._id.toString()
            }
        },
        platformRef: {
            type: 'Company',
            entityId: company._id.toString(),
            userId: user._id.toString()
        }
    })
}

/**
 * Company rejected by admin
 */
notifyCRM.companyRejected = (user, company, reason) => {
    notifyCRM({
        email: user.email,
        phone: user.mobile,
        company: company.companyName,
        type: 'COMPANY',
        channel: 'PLATFORM_REGISTRATION',
        crmStatus: 'LOST',
        crmSubStatus: 'REJECTED',
        journeyEvent: {
            type: 'STATUS_CHANGED',
            channel: 'PLATFORM_REGISTRATION',
            description: `Company rejected: ${reason || 'No reason provided'}`,
            data: {
                userId: user._id.toString(),
                companyId: company._id.toString(),
                reason: reason || null
            }
        }
    })
}

module.exports = notifyCRM