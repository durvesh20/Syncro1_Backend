// backend/controllers/reportController.js
// ---------------------------------------------------------------------------
// Endpoints for the "Download Report" feature. All endpoints require an
// authenticated user (protect middleware) and a role that is allowed for the
// requested report type (enforced here against the registry).
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');
const ReportTemplate = require('../models/ReportTemplate');
const ReportDownloadLog = require('../models/ReportDownloadLog');
const auditService = require('../services/auditService');
const {
  reportFieldRegistry,
  getConfigForRole,
  getValidFieldKeys
} = require('../config/reportFieldRegistry');
const reportService = require('../services/reportService');

// Reject if the report type is unknown or the caller's role isn't allowed.
function assertAllowed(req, res, reportType) {
  const def = reportFieldRegistry[reportType];
  if (!def) {
    res.status(404).json({ success: false, message: 'Unknown report type' });
    return null;
  }
  if (!def.allowedRoles.includes(req.user.role)) {
    res.status(403).json({ success: false, message: 'Your role cannot access this report type' });
    return null;
  }
  return def;
}

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- GET /api/reports/types ----------------------------------------------
exports.getReportTypes = async (req, res) => {
  try {
    const types = reportService.getReportTypesForRole(req.user.role);
    res.json({ success: true, data: { reportTypes: types } });
  } catch (err) {
    console.error('[reports] getReportTypes error:', err);
    res.status(500).json({ success: false, message: 'Failed to load report types' });
  }
};

// ---- GET /api/reports/config/:reportType ----------------------------------
exports.getReportConfig = async (req, res) => {
  try {
    const { reportType } = req.params;
    if (!assertAllowed(req, res, reportType)) return;

    const config = getConfigForRole(reportType, req.user.role);
    res.json({ success: true, data: config });
  } catch (err) {
    console.error('[reports] getReportConfig error:', err);
    res.status(500).json({ success: false, message: 'Failed to load report config' });
  }
};

// ---- GET /api/reports/template/:reportType --------------------------------
// Returns all saved structures (templates) for the caller and reportType
exports.getReportTemplate = async (req, res) => {
  try {
    const { reportType } = req.params;
    if (!assertAllowed(req, res, reportType)) return;

    const templates = await ReportTemplate.find({
      userId: req.user._id,
      reportType
    }).sort({ updatedAt: -1 }).lean();

    res.json({
      success: true,
      data: templates
    });
  } catch (err) {
    console.error('[reports] getReportTemplate error:', err);
    res.status(500).json({ success: false, message: 'Failed to load templates' });
  }
};

// ---- POST /api/reports/template/:reportType -------------------------------
exports.saveReportTemplate = async (req, res) => {
  try {
    const { reportType } = req.params;
    if (!assertAllowed(req, res, reportType)) return;

    const { selectedFields = [], selectedFilters = {}, name } = req.body || {};
    const templateName = name?.trim() || `Structure - ${new Date().toLocaleString('en-IN')}`;

    // Validate selected fields against the registry (reject unknown keys)
    const validKeys = new Set(getValidFieldKeys(reportType));
    const cleanFields = (selectedFields || []).filter(
      (k) => typeof k === 'string' && validKeys.has(k)
    );

    const updated = await ReportTemplate.findOneAndUpdate(
      { userId: req.user._id, reportType, name: templateName },
      {
        userId: req.user._id,
        role: req.user.role,
        reportType,
        name: templateName,
        selectedFields: cleanFields,
        selectedFilters
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({
      success: true,
      message: 'Report structure saved to history',
      data: updated
    });
  } catch (err) {
    console.error('[reports] saveReportTemplate error:', err);
    res.status(500).json({ success: false, message: 'Failed to save structure' });
  }
};

// ---- DELETE /api/reports/template/:templateId ------------------------------
exports.deleteReportTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const deleted = await ReportTemplate.findOneAndDelete({
      _id: templateId,
      userId: req.user._id
    });
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Structure not found' });
    }
    res.json({ success: true, message: 'Structure deleted' });
  } catch (err) {
    console.error('[reports] deleteReportTemplate error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete structure' });
  }
};

// ---- GET /api/reports/admin/logs ------------------------------------------
// Returns all report download logs (Admin/Sub-Admin only)
exports.getAdminReportDownloadLogs = async (req, res) => {
  try {
    // Only admin and sub_admin can view the logs
    if (req.user.role !== 'admin' && req.user.role !== 'sub_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { page = 1, limit = 20, reportType } = req.query;
    const query = {};
    if (reportType) {
      query.reportType = reportType;
    }

    const total = await ReportDownloadLog.countDocuments(query);
    const logs = await ReportDownloadLog.find(query)
      .populate('userId', 'email name')
      .sort({ generatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / limit),
          limit: Number(limit)
        }
      }
    });
  } catch (err) {
    console.error('[reports] getAdminReportDownloadLogs error:', err);
    res.status(500).json({ success: false, message: 'Failed to load download logs' });
  }
};

// ---- POST /api/reports/preview --------------------------------------------
// Returns the header row labels in selected order. No DB query.
exports.previewReport = async (req, res) => {
  try {
    const { reportType, selectedFields = [] } = req.body || {};
    if (!assertAllowed(req, res, reportType)) return;

    const validKeys = new Set(getValidFieldKeys(reportType, req.user.role));
    const validFields = (selectedFields || []).filter(
      (k) => typeof k === 'string' && validKeys.has(k)
    );

    const headers = reportService.previewHeaders(reportType, validFields, req.user.role);
    res.json({ success: true, data: { headers } });
  } catch (err) {
    console.error('[reports] previewReport error:', err);
    res.status(500).json({ success: false, message: 'Failed to preview report' });
  }
};

// ---- POST /api/reports/generate -------------------------------------------
// Runs the scoped query, streams the .xlsx file, and writes an audit log.
exports.generateReport = async (req, res) => {
  try {
    const { reportType, selectedFields = [], filters = {} } = req.body || {};
    const def = assertAllowed(req, res, reportType);
    if (!def) return;

    const validKeys = new Set(getValidFieldKeys(reportType, req.user.role));
    const validFields = (selectedFields || []).filter(
      (k) => typeof k === 'string' && validKeys.has(k)
    );
    if (validFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Select at least one field to generate the report'
      });
    }

    // Diagnostic: verify the base collection has documents
    const Candidate = mongoose.model('Candidate');
    const totalCandidates = await Candidate.countDocuments({});
    console.log(`[reports] DB check: total candidates in collection = ${totalCandidates}`);

    const cursor = await reportService.buildCursor({
      reportType,
      user: req.user,
      selectedFields: validFields,
      filters: filters || {}
    });

    console.log(`[reports] generate: user=${req.user._id} role=${req.user.role} type=${reportType} fields=${validFields.length} filters=`, JSON.stringify(filters));

    // No scoping entity -> empty result (still produce a valid file)
    if (cursor === null) {
      const fileName = `${reportType.toLowerCase()}_${todayStamp()}.xlsx`;
      const rowCount = await reportService.streamReportToResponse({
        res,
        reportType,
        selectedFields: validFields,
        cursor: null,
        fileName,
        role: req.user.role
      });
      await writeAuditLog(req, reportType, filters, validFields, rowCount, fileName);
      return;
    }

    const fileName = `${reportType.toLowerCase()}_${todayStamp()}.xlsx`;
    const rowCount = await reportService.streamReportToResponse({
      res,
      reportType,
      selectedFields: validFields,
      cursor,
      fileName,
      role: req.user.role
    });

    // Best-effort audit (response already streamed, so never throw)
    await writeAuditLog(req, reportType, filters, validFields, rowCount, fileName);
  } catch (err) {
    console.error('[reports] generateReport error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to generate report' });
    }
  }
};

// ---- POST /api/reports/debug ----------------------------------------------
// Diagnostic endpoint: returns sample rows as JSON (no file streaming).
exports.debugReport = async (req, res) => {
  try {
    const { reportType, selectedFields = [], filters = {} } = req.body || {};
    const def = assertAllowed(req, res, reportType);
    if (!def) return;

    const validKeys = new Set(getValidFieldKeys(reportType, req.user.role));
    const validFields = (selectedFields || []).filter(
      (k) => typeof k === 'string' && validKeys.has(k)
    );

    const result = await reportService.debugQuery({
      reportType,
      user: req.user,
      selectedFields: validFields,
      filters: filters || {}
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[reports] debugReport error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

async function writeAuditLog(req, reportType, filters, validFields, rowCount, fileName) {
  try {
    const log = await ReportDownloadLog.create({
      userId: req.user._id,
      role: req.user.role,
      reportType,
      filtersUsed: filters || {},
      fieldsUsed: validFields,
      rowCount,
      fileName,
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    // Mirror to the existing admin audit trail so admins can view it there.
    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'REPORT_DOWNLOAD',
      entityType: 'Report',
      entityId: log._id,
      description: `Downloaded "${reportFieldRegistry[reportType]?.label}" report (${rowCount} rows)`,
      before: null,
      after: { reportType, rowCount, fieldsUsed: validFields, filtersUsed: filters },
      notes: null,
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });
  } catch (e) {
    console.error('[reports] audit log failed:', e.message);
  }
}
