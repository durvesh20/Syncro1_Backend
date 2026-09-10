const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

let cachedLogoDataUri = null;
function getLogoDataUri() {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const potentialPaths = [
    path.join(__dirname, '../assets/syncro1-logo.svg'),
    path.join(__dirname, '../../Syncro1-WebApp/src/assets/syncro1-logo.svg'),
  ];
  for (const p of potentialPaths) {
    try {
      if (fs.existsSync(p)) {
        const svg = fs.readFileSync(p, 'utf8');
        cachedLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        return cachedLogoDataUri;
      }
    } catch (_) {}
  }
  return '';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatSalary(salary) {
  if (!salary) return 'Not Specified';
  const min = salary.min;
  const max = salary.max;
  const currency = salary.currency || 'INR';
  const symbol = currency === 'INR' ? '₹' : currency;

  if (min && max) {
    return `${symbol} ${min} - ${max} LPA`;
  } else if (min) {
    return `${symbol} ${min}+ LPA`;
  } else if (max) {
    return `Up to ${symbol} ${max} LPA`;
  }
  return 'Negotiable';
}

function generateJobHtml(job, jobPosition, options = {}) {
  const isAdmin = options.isAdmin || false;
  const companyName = isAdmin 
    ? (job.company?.companyName || 'Company Confirmed') 
    : (job.company?.companyName ? 'Confidential Hiring Client' : 'Confidential Hiring Client');

  const locationText = Array.isArray(job.location?.city)
    ? job.location.city.join(', ')
    : (job.location?.city || 'Location on Request');

  const workModes = [];
  if (job.location?.isRemote) workModes.push('Remote');
  if (job.location?.isHybrid) workModes.push('Hybrid');
  if (job.location?.isOnSite || job.location?.isOnsite) workModes.push('On-Site');
  const workModeText = workModes.length > 0 ? workModes.join(' / ') : 'On-Site';

  const expText = job.experienceRange?.min !== undefined && job.experienceRange?.max !== undefined
    ? `${job.experienceRange.min} - ${job.experienceRange.max} Years`
    : (job.experienceLevel || 'Not Specified');

  // Skills
  const requiredSkills = Array.isArray(job.skills?.required) ? job.skills.required : [];
  const preferredSkills = Array.isArray(job.skills?.preferred) ? job.skills.preferred : [];

  const parsedSkills = jobPosition?.parsedRequirements?.skills || {};
  const mustHave = Array.isArray(parsedSkills.mustHave) ? parsedSkills.mustHave : [];
  const shouldHave = Array.isArray(parsedSkills.shouldHave) ? parsedSkills.shouldHave : [];
  const niceToHave = Array.isArray(parsedSkills.niceToHave) ? parsedSkills.niceToHave : [];

  // Description paragraphs
  const descriptionHtml = escapeHtml(job.description || '')
    .split('\n')
    .filter(p => p.trim())
    .map(p => `<p class="desc-para">${p}</p>`)
    .join('');

  // Requirements
  const requirementsList = Array.isArray(job.requirements) ? job.requirements : [];
  const responsibilitiesList = Array.isArray(job.responsibilities) ? job.responsibilities : [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Job Description - ${escapeHtml(job.title)}</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 16mm 18mm 16mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    body {
      background-color: #ffffff;
      color: #1e293b;
      font-size: 11pt;
      line-height: 1.5;
    }
    /* Header */
    .header {
      border-bottom: 2px solid #2563eb;
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .brand-container {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-logo-img {
      height: 36px;
      width: auto;
      object-fit: contain;
      display: block;
    }
    .brand-spec-label {
      font-size: 9.5pt;
      font-weight: 700;
      color: #64748b;
      letter-spacing: 0.5px;
    }
    .job-id-badge {
      background-color: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 3px 9px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 9pt;
      font-weight: 700;
      color: #334155;
    }
    .job-title {
      font-size: 18pt;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.2;
      margin-bottom: 6px;
    }
    .job-subtitle {
      font-size: 10pt;
      color: #64748b;
      font-weight: 600;
    }
    /* Info Grid */
    .info-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 18px;
    }
    .info-card {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      margin-bottom: 2px;
    }
    .info-value {
      font-size: 9.5pt;
      font-weight: 700;
      color: #0f172a;
    }
    .info-value.highlight {
      color: #059669;
    }
    /* Sections */
    .section {
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 10.5pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #1e293b;
      border-left: 3.5px solid #2563eb;
      padding-left: 8px;
      margin-bottom: 8px;
    }
    .desc-para {
      margin-bottom: 8px;
      color: #334155;
      font-size: 9.5pt;
      line-height: 1.55;
      text-align: justify;
    }
    .bullet-list {
      list-style-type: none;
      padding-left: 0;
    }
    .bullet-list li {
      position: relative;
      padding-left: 14px;
      margin-bottom: 5px;
      font-size: 9.5pt;
      color: #334155;
      line-height: 1.45;
    }
    .bullet-list li::before {
      content: "•";
      position: absolute;
      left: 0;
      top: 0;
      color: #2563eb;
      font-weight: bold;
      font-size: 11pt;
    }
    /* Skills */
    .skills-container {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
      margin-bottom: 6px;
    }
    .skill-badge {
      padding: 3px 8px;
      border-radius: 5px;
      font-size: 8.5pt;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .skill-must {
      background-color: #fee2e2;
      color: #991b1b;
      border-color: #fecaca;
    }
    .skill-should {
      background-color: #fef3c7;
      color: #92400e;
      border-color: #fde68a;
    }
    .skill-nice {
      background-color: #e0f2fe;
      color: #075985;
      border-color: #bae6fd;
    }
    .skill-general {
      background-color: #f1f5f9;
      color: #334155;
      border-color: #e2e8f0;
    }
    .skill-category-label {
      font-size: 8.5pt;
      font-weight: 700;
      color: #475569;
      margin-top: 6px;
      margin-bottom: 3px;
    }
    /* Footer */
    .footer {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8pt;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-top">
      <div class="brand-container">
        ${getLogoDataUri() ? `<img src="${getLogoDataUri()}" alt="Syncro1" class="brand-logo-img" />` : `<div style="font-size: 15pt; font-weight: 900; color: #1e3a8a;">Syncro<span style="color: #2563eb;">1</span></div>`}
        <span class="brand-spec-label">| JOB SPECIFICATION</span>
      </div>
      ${job.uniqueId ? `<div class="job-id-badge">ID: ${escapeHtml(job.uniqueId)}</div>` : ''}
    </div>
    <div class="job-title">${escapeHtml(job.title)}</div>
    <div class="job-subtitle">
      ${escapeHtml(companyName)} · ${escapeHtml(job.category || 'General')} ${job.subCategory ? `(${escapeHtml(job.subCategory)})` : ''}
    </div>
  </div>

  <!-- Key Info Grid -->
  <div class="info-grid">
    <div class="info-card">
      <span class="info-label">Experience</span>
      <span class="info-value">${escapeHtml(expText)}</span>
    </div>
    <div class="info-card">
      <span class="info-label">Compensation</span>
      <span class="info-value highlight">${escapeHtml(formatSalary(job.salary))}</span>
    </div>
    <div class="info-card">
      <span class="info-label">Location</span>
      <span class="info-value">${escapeHtml(locationText)}</span>
    </div>
    <div class="info-card">
      <span class="info-label">Work Mode</span>
      <span class="info-value">${escapeHtml(workModeText)}</span>
    </div>
    <div class="info-card" style="margin-top: 8px;">
      <span class="info-label">Employment Type</span>
      <span class="info-value">${escapeHtml(job.employmentType || 'Full-time')}</span>
    </div>
    <div class="info-card" style="margin-top: 8px;">
      <span class="info-label">Open Positions</span>
      <span class="info-value">${job.vacancies || 1} ${job.vacancies > 1 ? 'Openings' : 'Opening'}</span>
    </div>
    <div class="info-card" style="margin-top: 8px;">
      <span class="info-label">Education</span>
      <span class="info-value">${escapeHtml(job.education?.minimum || 'Any Graduate')}</span>
    </div>
    <div class="info-card" style="margin-top: 8px;">
      <span class="info-label">Status</span>
      <span class="info-value" style="color: #2563eb;">${escapeHtml(job.status || 'ACTIVE')}</span>
    </div>
  </div>

  <!-- Description Section -->
  <div class="section">
    <div class="section-title">About the Role / Job Description</div>
    ${descriptionHtml}
  </div>

  <!-- Responsibilities -->
  ${responsibilitiesList.length > 0 ? `
  <div class="section">
    <div class="section-title">Key Responsibilities</div>
    <ul class="bullet-list">
      ${responsibilitiesList.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  <!-- Requirements -->
  ${requirementsList.length > 0 ? `
  <div class="section">
    <div class="section-title">Requirements & Qualifications</div>
    <ul class="bullet-list">
      ${requirementsList.map(req => `<li>${escapeHtml(req)}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  <!-- Skills Breakdown -->
  ${(requiredSkills.length > 0 || mustHave.length > 0) ? `
  <div class="section">
    <div class="section-title">Skills & Competencies</div>
    ${mustHave.length > 0 ? `
      <div class="skill-category-label">Must-Have Skills:</div>
      <div class="skills-container">
        ${mustHave.map(s => `<span class="skill-badge skill-must">${escapeHtml(s)}</span>`).join('')}
      </div>
    ` : ''}

    ${shouldHave.length > 0 ? `
      <div class="skill-category-label">Good to Have / Secondary:</div>
      <div class="skills-container">
        ${shouldHave.map(s => `<span class="skill-badge skill-should">${escapeHtml(s)}</span>`).join('')}
      </div>
    ` : ''}

    ${niceToHave.length > 0 ? `
      <div class="skill-category-label">Optional / Bonus:</div>
      <div class="skills-container">
        ${niceToHave.map(s => `<span class="skill-badge skill-nice">${escapeHtml(s)}</span>`).join('')}
      </div>
    ` : ''}

    ${mustHave.length === 0 && requiredSkills.length > 0 ? `
      <div class="skill-category-label">Required Skills:</div>
      <div class="skills-container">
        ${requiredSkills.map(s => `<span class="skill-badge skill-general">${escapeHtml(s)}</span>`).join('')}
      </div>
    ` : ''}

    ${preferredSkills.length > 0 ? `
      <div class="skill-category-label">Preferred Skills:</div>
      <div class="skills-container">
        ${preferredSkills.map(s => `<span class="skill-badge skill-should">${escapeHtml(s)}</span>`).join('')}
      </div>
    ` : ''}
  </div>
  ` : ''}

  <!-- Footer -->
  <div class="footer">
    <span>Document Generated via Syncro1 Recruitment Platform</span>
    <span>Confidential & Proprietary</span>
  </div>
</body>
</html>`;
}

class JobPositionPdfService {
  /**
   * Generates a PDF buffer for a Job document and associated JobPosition document
   */
  async generateJobPdf(job, jobPosition, options = {}) {
    let browser = null;
    try {
      const html = generateJobHtml(job, jobPosition, options);

      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '12mm',
          right: '12mm',
          bottom: '12mm',
          left: '12mm'
        },
        displayHeaderFooter: false
      });

      await browser.close();
      browser = null;

      return pdfBuffer;
    } catch (err) {
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
      console.error('[JOB_POSITION_PDF] Error generating PDF:', err);
      throw err;
    }
  }
}

module.exports = new JobPositionPdfService();

