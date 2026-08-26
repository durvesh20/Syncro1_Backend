// backend/services/reportService.js
// ---------------------------------------------------------------------------
// Core engine for the "Download Report" feature:
//   - resolves role scope at the query level (never trusts the frontend)
//   - builds a MongoDB aggregation from the field registry + filters
//   - streams the result to an .xlsx file via exceljs (WorkbookWriter)
//   - prepares audit entries (ReportDownloadLog + mirror to AdminActionLog)
// ---------------------------------------------------------------------------
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const {
  reportFieldRegistry,
  getFieldMap
} = require('../config/reportFieldRegistry');

const Company = require('../models/Company');
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');

// Map a registry `base` collection name -> Mongoose model
const BASE_MODEL = {
  candidates: 'Candidate',
  jobs: 'Job',
  companies: 'Company',
  staffingpartners: 'StaffingPartner'
};

// ---- small utils ----------------------------------------------------------

function toObjectId(value) {
  try {
    return new mongoose.Types.ObjectId(value);
  } catch (e) {
    return null;
  }
}

// Safe dotted-path getter (lodash.get replacement)
function getPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    return acc[key];
  }, obj);
}

function endOfDay(dateStr) {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ---- report-type listing --------------------------------------------------

function getReportTypesForRole(role) {
  return Object.keys(reportFieldRegistry)
    .filter((rt) => reportFieldRegistry[rt].allowedRoles.includes(role))
    .map((rt) => ({
      reportType: rt,
      label: reportFieldRegistry[rt].label,
      description: reportFieldRegistry[rt].description
    }));
}

// ---- scope resolution (query-level enforcement) ---------------------------

// Returns a match fragment that hard-restricts data to the caller's scope,
// or null if the caller has no scoping entity (e.g. company user w/o Company doc).
async function resolveScope(user, def) {
  if (!def.scope) return {}; // admin reports: no scope
  if (def.scope.collection === 'companies') {
    const doc = await Company.findOne({ user: user._id }).select('_id').lean();
    return doc ? { [def.scope.field]: doc._id } : null;
  }
  if (def.scope.collection === 'staffingpartners') {
    const doc = await StaffingPartner.findOne({ user: user._id }).select('_id').lean();
    return doc ? { [def.scope.field]: doc._id } : null;
  }
  return {};
}

// ---- filter -> $match builder --------------------------------------------

async function buildFilterMatch(def, filters = {}) {
  const match = {};
  const registryFilters = def.filters || [];

  for (const f of registryFilters) {
    const val = filters[f.key];
    if (val === undefined || val === null || val === '' || val === 'ALL') continue;
    if (Array.isArray(val) && (val.length === 0 || val.includes('ALL'))) continue;

    if (f.type === 'dateRange') {
      const range = {};
      if (val.from) range.$gte = new Date(val.from);
      if (val.to) range.$lte = endOfDay(val.to);
      if (Object.keys(range).length) match[f.appliesTo] = range;
    } else if (f.key === 'status' && (def.base === 'staffingpartners' || def.base === 'companies')) {
      const arr = (Array.isArray(val) ? val : [val]).filter((v) => v && v !== 'ALL' && v !== '');
      if (arr.length > 0) {
        const orConditions = [];
        arr.forEach((v) => {
          if (v === 'REGISTERED') {
            orConditions.push({ verificationStatus: { $in: ['PENDING', null] } });
          } else if (v === 'UNDER_REVIEW') {
            orConditions.push({ verificationStatus: 'UNDER_REVIEW' });
          } else if (v === 'VERIFIED' || v === 'APPROVED' || v === 'ACTIVE') {
            orConditions.push({ verificationStatus: 'APPROVED' });
          } else if (v === 'REJECTED') {
            orConditions.push({ verificationStatus: 'REJECTED' });
          }
        });

        const userStatuses = [];
        if (arr.includes('SUSPENDED')) userStatuses.push('SUSPENDED');
        if (arr.includes('PENDING_EMAIL_VERIFICATION')) userStatuses.push('PENDING_EMAIL_VERIFICATION');

        if (userStatuses.length > 0) {
          const matchedUsers = await User.find({ status: { $in: userStatuses } }).select('_id').lean();
          const uIds = matchedUsers.map((u) => u._id);
          orConditions.push({ user: { $in: uIds } });
        }

        if (orConditions.length === 1) {
          Object.assign(match, orConditions[0]);
        } else if (orConditions.length > 1) {
          match.$or = orConditions;
        }
      }
    } else if (f.type === 'multiSelectStatus' || f.key === 'status') {
      const arr = (Array.isArray(val) ? val : [val]).filter((v) => v && v !== 'ALL' && v !== '');
      if (arr.length === 1) {
        match[f.appliesTo] = arr[0];
      } else if (arr.length > 1) {
        match[f.appliesTo] = { $in: arr };
      }
    } else if (['multiselect', 'multiSelect', 'jobSelect', 'companySelect', 'partnerSelect'].includes(f.type)) {
      const arr = (Array.isArray(val) ? val : [val])
        .map(toObjectId)
        .filter(Boolean);
      if (arr.length === 1) {
        match[f.appliesTo] = arr[0];
      } else if (arr.length > 1) {
        match[f.appliesTo] = { $in: arr };
      }
    } else {
      // select fallback
      if (Array.isArray(val)) {
        const arr = val.filter((v) => v && v !== 'ALL' && v !== '');
        if (arr.length === 1) match[f.appliesTo] = arr[0];
        else if (arr.length > 1) match[f.appliesTo] = { $in: arr };
      } else {
        match[f.appliesTo] = val;
      }
    }
  }
  return match;
}

// ---- value formatting -----------------------------------------------------

function computeValue(doc, fieldDef) {
  switch (fieldDef.compute) {
    case 'tp_status':
    case 'co_status': {
      const userStatus = getPath(doc, 'userInfo.status');
      const verStatus = getPath(doc, 'verificationStatus');

      if (userStatus === 'SUSPENDED') return 'SUSPENDED';
      if (userStatus === 'REJECTED' || verStatus === 'REJECTED') return 'REJECTED';
      if (verStatus === 'APPROVED' || userStatus === 'VERIFIED') return 'VERIFIED';
      if (verStatus === 'UNDER_REVIEW') return 'UNDER_REVIEW';
      if (userStatus === 'ACTIVE' || userStatus === 'REGISTERED') return 'REGISTERED';
      if (userStatus === 'PENDING_EMAIL_VERIFICATION') return 'PENDING_EMAIL_VERIFICATION';

      return verStatus || userStatus || 'REGISTERED';
    }
    case 'submissionToHireRatio': {
      const submitted = getPath(doc, 'metrics.totalSubmissions') || 0;
      const placed = getPath(doc, 'metrics.totalPlacements') || 0;
      if (!submitted) return 0;
      return Math.round((placed / submitted) * 100) / 100;
    }
    case 'cand_fullName': {
      const first = getPath(doc, 'firstName') || '';
      const last = getPath(doc, 'lastName') || '';
      return [first, last].filter(Boolean).join(' ') || 'N/A';
    }
    case 'cand_education': {
      const edu = getPath(doc, 'profile.education');
      if (Array.isArray(edu) && edu.length > 0) {
        const formatted = edu
          .map((e) => {
            if (typeof e === 'string') return e;
            if (typeof e === 'object' && e !== null) {
              const parts = [e.degree, e.institution, e.year].filter(Boolean);
              return parts.join(' - ');
            }
            return String(e);
          })
          .filter(Boolean);
        if (formatted.length > 0) return formatted.join('; ');
      }
      if (typeof edu === 'string' && edu.trim().length > 0) {
        return edu.trim();
      }
      const aiEdu = getPath(doc, 'resumeAnalysis.scoreBreakdown.education.candidateEducation');
      if (aiEdu && typeof aiEdu === 'string' && aiEdu.trim().length > 0 && aiEdu !== 'Not provided') {
        return aiEdu.trim();
      }
      const rawAiEdu = getPath(doc, 'resumeAnalysis.education');
      if (Array.isArray(rawAiEdu) && rawAiEdu.length > 0) {
        return rawAiEdu.join('; ');
      }
      return 'N/A';
    }
    case 'cand_writeup': {
      const writeup =
        getPath(doc, 'profile.writeup') ||
        getPath(doc, 'submissionMetadata.partnerNotes') ||
        getPath(doc, 'adminQueue.reviewNotes') ||
        getPath(doc, 'resumeAnalysis.summary');
      return writeup || 'N/A';
    }
    case 'rej_rejectedBy': {
      // reviewedByUser is the $lookup result from users collection
      const user = doc.reviewedByUser;
      if (!user) return '';
      const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ');
      return name || user.email || '';
    }
    default:
      return '';
  }
}

function formatValue(doc, fieldDef) {
  if (fieldDef.compute) return computeValue(doc, fieldDef);

  const raw = getPath(doc, fieldDef.path);

  // Format Experience fields with 'years' / 'year' suffix
  const key = (fieldDef.key || '').toLowerCase();
  const path = (fieldDef.path || '').toLowerCase();
  const label = (fieldDef.label || '').toLowerCase();

  const isExpField =
    ['cand_totalexp', 'cand_relexp', 'job_expmin', 'job_expmax'].includes(key) ||
    key.includes('exp') ||
    path.includes('experience') ||
    label.includes('experience');

  if (isExpField) {
    if (raw === undefined || raw === null || raw === '') return '';
    const str = String(raw).trim();
    if (!str) return '';
    if (/years?|yrs?/i.test(str)) return str;
    const num = Number(str);
    if (!isNaN(num)) {
      return num === 1 ? `${num} year` : `${num} years`;
    }
    return `${str} years`;
  }

  // Format Salary fields with 'LPA' suffix (converting 12,00,000 -> 12 LPA, 7,50,000 -> 7.5 LPA)
  const isSalaryField =
    ['cand_currentsalary', 'cand_expectedsalary', 'job_salarymin', 'job_salarymax'].includes(key) ||
    (key.includes('salary') && !key.includes('currency')) ||
    (path.includes('salary') && !path.includes('currency')) ||
    label.includes('ctc') ||
    (label.includes('salary') && !label.includes('currency'));

  if (isSalaryField) {
    if (raw === undefined || raw === null || raw === '') return '';
    const str = String(raw).trim();
    if (!str) return '';
    if (/LPA|Lakhs?/i.test(str)) return str;

    const cleanStr = str.replace(/[^0-9.]/g, '');
    if (!cleanStr) return str;

    let num = Number(cleanStr);
    if (isNaN(num)) return str;

    if (num > 100) {
      num = num / 100000;
    }

    const formattedNum = Number(num.toFixed(2)).toString();
    return `${formattedNum} LPA`;
  }

  switch (fieldDef.type) {
    case 'date': {
      if (!raw) return '';
      const d = new Date(raw);
      return isNaN(d.getTime()) ? '' : d;
    }
    case 'number': {
      if (raw === undefined || raw === null || raw === '') return '';
      const n = Number(raw);
      return isNaN(n) ? '' : n;
    }
    case 'array': {
      if (Array.isArray(raw)) return raw.join(', ');
      return raw == null ? '' : String(raw);
    }
    case 'boolean':
      return raw === true ? 'Yes' : raw === false ? 'No' : '';
    case 'string':
    default:
      return raw == null ? '' : String(raw);
  }
}

// ---- aggregation builder --------------------------------------------------

// Returns a Mongoose aggregation cursor for the report.
async function buildCursor({ reportType, user, selectedFields, filters }) {
  const def = reportFieldRegistry[reportType];
  const Model = mongoose.model(BASE_MODEL[def.base]);

  const scope = await resolveScope(user, def);
  if (scope === null) {
    // Caller has no scoping entity -> no data
    return null;
  }

  const filterMatch = await buildFilterMatch(def, filters);
  const match = { ...scope, ...filterMatch };

  console.log(`[reports] buildCursor: base=${def.base}, scope=`, scope, 'match=', match);

  const pipeline = [{ $match: match }];

  // Joins declared in the registry (unwound so registry paths resolve)
  (def.lookups || []).forEach((lk) => {
    pipeline.push({
      $lookup: {
        from: lk.from,
        localField: lk.localField,
        foreignField: lk.foreignField,
        as: lk.as
      }
    });
    pipeline.push({
      $unwind: { path: `$${lk.as}`, preserveNullAndEmptyArrays: true }
    });
  });

  // Stable sort so reports are reproducible
  pipeline.push({ $sort: { createdAt: -1 } });

  // Diagnostic: check if the match returns any documents before streaming
  const countBefore = await Model.countDocuments(match);
  console.log(`[reports] buildCursor: ${def.base} count=${countBefore} for match=`, JSON.stringify(match));
  if (countBefore === 0) {
    console.warn(`[reports] WARNING: 0 documents match! Pipeline:`);
    console.warn(JSON.stringify(pipeline, (k, v) => typeof v === 'function' ? undefined : v, 2));
  }

  return Model.aggregate(pipeline).cursor();
}

// ---- preview headers (no DB query) ----------------------------------------

function previewHeaders(reportType, selectedFields, role) {
  const fieldMap = getFieldMap(reportType, role);
  return (selectedFields || [])
    .map((k) => fieldMap[k])
    .filter(Boolean)
    .map((f) => f.label);
}

// ---- Excel streaming ------------------------------------------------------

function sheetName(reportType) {
  return (reportFieldRegistry[reportType]?.label || 'Report')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .slice(0, 31);
}

/**
 * Build the report in memory and send as a single response.
 * Errors happen BEFORE any bytes are sent to the client, so the frontend
 * always gets either a valid .xlsx file or a proper JSON error.
 */
async function streamReportToResponse({ res, reportType, selectedFields, cursor, fileName, role }) {
  const fieldMap = getFieldMap(reportType, role);
  const orderedFields = (selectedFields || []).map((k) => fieldMap[k]).filter(Boolean);
  const headers = orderedFields.map((f) => f.label);

  // Collect all rows from the cursor into memory first.
  // This lets any aggregation / format errors throw BEFORE we set headers.
  const rows = [];
  if (cursor) {
    await cursor.eachAsync((doc) => {
      rows.push(orderedFields.map((f) => formatValue(doc, f)));
    });
  }

  console.log(`[reports] ${fileName}: ${rows.length} data rows collected`);

  // NOW set headers — only after we know the data is valid.
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'no-store');

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(sheetName(reportType), { views: [{ state: 'frozen', ySplit: 1 }] });

  // Column widths + date formatting
  ws.columns = orderedFields.map((f) => ({
    header: f.label,
    key: f.key,
    width: Math.min(Math.max((f.label || '').length + 4, 12), 48),
    style: f.type === 'date' ? { numFmt: 'yyyy-mm-dd' } : undefined
  }));

  // Style the header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };

  // Add data rows
  rows.forEach((rowValues) => {
    ws.addRow(rowValues);
  });

  // Write to buffer, then send (use res.send if Express, fall back to res.end)
  const buffer = await workbook.xlsx.writeBuffer();
  const buf = Buffer.from(buffer);
  if (typeof res.send === 'function') {
    res.send(buf);
  } else {
    res.end(buf);
  }

  return rows.length;
}

/**
 * Run the aggregation and return sample rows as JSON (no streaming).
 * Useful for debugging: POST /api/reports/debug
 */
async function debugQuery({ reportType, user, selectedFields, filters }) {
  const def = reportFieldRegistry[reportType];
  if (!def) throw new Error('Unknown report type');

  const Model = mongoose.model(BASE_MODEL[def.base]);
  const scope = await resolveScope(user, def);

  const filterMatch = await buildFilterMatch(def, filters);
  const match = { ...(scope || {}), ...filterMatch };

  const pipeline = [{ $match: match }];

  (def.lookups || []).forEach((lk) => {
    pipeline.push({
      $lookup: {
        from: lk.from,
        localField: lk.localField,
        foreignField: lk.foreignField,
        as: lk.as
      }
    });
    pipeline.push({
      $unwind: { path: `$${lk.as}`, preserveNullAndEmptyArrays: true }
    });
  });

  pipeline.push({ $sort: { createdAt: -1 } });
  const limitValue = typeof filters?.limit !== "undefined" ? parseInt(filters.limit, 10) : 5;
  if (limitValue > 0) {
    pipeline.push({ $limit: limitValue });
  }

  const sampleRows = await Model.aggregate(pipeline);
  const totalCount = await Model.countDocuments(match);

  const fieldMap = getFieldMap(reportType, user?.role);
  const orderedFields = (selectedFields || []).map((k) => fieldMap[k]).filter(Boolean);

  // Format the sample rows the same way the Excel builder does
  const formattedRows = sampleRows.map((doc) => {
    const row = {};
    orderedFields.forEach((f) => {
      row[f.key] = formatValue(doc, f);
    });
    return row;
  });

  return {
    totalCount,
    sampleRows: formattedRows,
    pipeline,
    scope,
    match
  };
}

module.exports = {
  getReportTypesForRole,
  resolveScope,
  buildFilterMatch,
  buildCursor,
  previewHeaders,
  streamReportToResponse,
  debugQuery,
  sheetName
};
