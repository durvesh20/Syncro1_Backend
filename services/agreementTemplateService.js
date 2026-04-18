// backend/services/agreementTemplateService.js

class AgreementTemplateService {

    generatePartnerAgreement(partnerData) {
        const {
            firmName,
            registeredName,
            entityType,
            registeredAddress,
            firstName,
            lastName,
            designation,
            panNumber,
            gstNumber,
            cinNumber,
            agreementDate,
            digitalSignature,
            signedAt,
            signedIp,
            city,
            state
        } = partnerData;

        const formattedDate = new Date(agreementDate || Date.now()).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'long', year: 'numeric'
        });

        const vendorLegalName = registeredName || firmName || '[VENDOR LEGAL NAME]';
        const vendorType = this._mapEntityType(entityType);
        const vendorAddress = this._formatAddress(registeredAddress);
        const signatoryName = `${firstName || ''} ${lastName || ''}`.trim() || '[AUTHORISED SIGNATORY]';
        const signedDateTime = new Date(signedAt || Date.now()).toLocaleString('en-IN', {
            day: 'numeric', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Master Staffing Partner Agreement - Syncro1</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #000;
    background: #fff;
  }

  .page {
    padding: 30px 55px 30px 55px;
  }

  /* ---- HEADER ---- */
  .doc-header {
    text-align: center;
    border-bottom: 2.5px double #000;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .doc-header h1 {
    font-size: 13pt;
    font-weight: bold;
    letter-spacing: 0.5px;
    margin-bottom: 3px;
  }
  .doc-header h2 {
    font-size: 11.5pt;
    font-weight: bold;
    margin-bottom: 3px;
  }
  .doc-header .confidential {
    font-size: 9pt;
    font-style: italic;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
  .doc-header .dated {
    font-size: 10.5pt;
    margin-top: 6px;
  }

  /* ---- ARTICLE TITLES ---- */
  .article-title {
    font-size: 10.5pt;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 18px;
    margin-bottom: 8px;
    border-bottom: 1px solid #333;
    padding-bottom: 3px;
    letter-spacing: 0.3px;
  }

  .sub-title {
    font-size: 10.5pt;
    font-weight: bold;
    text-decoration: underline;
    margin-top: 12px;
    margin-bottom: 5px;
  }

  /* ---- CLAUSES ---- */
  p { margin-bottom: 6px; text-align: justify; }
  .clause { margin-bottom: 7px; text-align: justify; }
  .indent { margin-left: 20px; margin-bottom: 5px; text-align: justify; }

  /* ---- LISTS ---- */
  .bullet-list { margin-left: 24px; margin-bottom: 6px; }
  .bullet-list li { margin-bottom: 3px; text-align: justify; list-style: disc; }

  /* ---- HIGHLIGHT ---- */
  .hl { font-weight: bold; }

  /* ---- DIVIDERS ---- */
  .divider { border-top: 1.5px solid #000; margin: 10px 0; }
  .divider-thin { border-top: 0.5px solid #999; margin: 8px 0; }

  /* ---- TABLES ---- */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0;
    font-size: 9.5pt;
  }
  table th {
    background: #d0d0d0;
    border: 1px solid #000;
    padding: 6px 8px;
    font-weight: bold;
    text-align: left;
  }
  table td {
    border: 1px solid #000;
    padding: 5px 8px;
    vertical-align: top;
  }

  /* ---- SIGNATURE SECTION ---- */
  .sig-section {
    margin-top: 30px;
    page-break-inside: avoid;
  }
  .sig-section h3 {
    font-size: 11pt;
    font-weight: bold;
    text-align: center;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  .sig-section .witness-text {
    text-align: center;
    margin-bottom: 20px;
    font-style: italic;
    font-size: 10pt;
  }
  .sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border: 1.5px solid #000;
  }
  .sig-col {
    padding: 16px 18px;
    vertical-align: top;
  }
  .sig-col:first-child {
    border-right: 1.5px solid #000;
  }
  .sig-col .party-label {
    font-size: 9pt;
    font-weight: bold;
    text-transform: uppercase;
    color: #444;
    margin-bottom: 3px;
  }
  .sig-col .party-name {
    font-size: 10.5pt;
    font-weight: bold;
    margin-bottom: 16px;
    text-transform: uppercase;
  }
  .sig-box {
    border: 1px solid #000;
    min-height: 52px;
    margin-bottom: 8px;
    padding: 4px 6px;
    background: #fafafa;
  }
  .sig-box .sig-text {
    font-family: 'Palatino Linotype', Palatino, serif;
    font-size: 18pt;
    font-style: italic;
    color: #1a1a6e;
    font-weight: bold;
  }
  .sig-box .sig-meta {
    font-size: 7.5pt;
    color: #555;
    margin-top: 2px;
    border-top: 1px dotted #ccc;
    padding-top: 2px;
  }
  .sig-field {
    margin-bottom: 5px;
    font-size: 10pt;
  }
  .sig-field span {
    display: inline-block;
    min-width: 140px;
    border-bottom: 1px solid #000;
    margin-left: 4px;
  }
  .blank-sig-box {
    border: 1px solid #000;
    min-height: 52px;
    margin-bottom: 8px;
    background: #fafafa;
  }
  .authority-note {
    margin-top: 14px;
    padding: 8px 10px;
    border: 0.5px solid #999;
    background: #f5f5f5;
    font-size: 9pt;
    font-style: italic;
    text-align: center;
  }

  /* ---- SCHEDULE ---- */
  .schedule-title {
    font-size: 11.5pt;
    font-weight: bold;
    text-transform: uppercase;
    text-align: center;
    margin: 18px 0 8px 0;
    border-bottom: 1.5px solid #000;
    padding-bottom: 4px;
  }

  /* ---- VENDOR DETAILS BOX ---- */
  .vendor-box {
    border: 1px solid #000;
    padding: 10px 14px;
    margin: 10px 0;
    background: #f9f9f9;
  }
  .vendor-box h4 {
    font-size: 10pt;
    font-weight: bold;
    margin-bottom: 6px;
    text-transform: uppercase;
    border-bottom: 0.5px solid #999;
    padding-bottom: 3px;
  }
  .vendor-row {
    display: grid;
    grid-template-columns: 160px 1fr;
    margin-bottom: 3px;
    font-size: 9.5pt;
  }
  .vendor-row .label { font-weight: bold; color: #333; }

  /* ---- FOOTER ---- */
  .doc-footer {
    margin-top: 20px;
    padding-top: 8px;
    border-top: 0.5px solid #aaa;
    font-size: 7.5pt;
    color: #666;
    text-align: center;
  }

  /* ---- CAPS ---- */
  .all-caps { text-transform: uppercase; font-weight: bold; }

</style>
</head>
<body>
<div class="page">

<!-- ==================== COVER HEADER ==================== -->
<div class="doc-header">
  <h1>SYNCRO1 TECHNOLOGIES PRIVATE LIMITED</h1>
  <h2>MASTER STAFFING PARTNER (VENDOR) AGREEMENT</h2>
  <p class="confidential">STRICTLY CONFIDENTIAL &mdash;&mdash;&mdash; LEGALLY BINDING DOCUMENT</p>
  <div class="divider-thin"></div>
  <p class="dated">Dated: <strong>${formattedDate}</strong></p>
</div>

<!-- ==================== PARTIES ==================== -->
<p><strong>BETWEEN:</strong></p>

<p style="margin-top:8px;">(1) <strong>SYNCRO1 TECHNOLOGIES PRIVATE LIMITED</strong>, a company incorporated under the Companies Act, 2013, bearing CIN [&bull;], and having its registered office at [Registered Office Address], Mumbai, Maharashtra, India (hereinafter referred to as <strong>&ldquo;Syncro1&rdquo;</strong>, which expression shall, unless repugnant to the context, include its successors and permitted assigns);</p>

<p style="margin:8px 0;"><strong>AND</strong></p>

<p>(2) <strong class="hl">${vendorLegalName}</strong>, a <strong>${vendorType}</strong>, incorporated / registered under applicable law, having its principal place of business / registered office at <strong class="hl">${vendorAddress}</strong> (hereinafter referred to as the <strong>&ldquo;Vendor&rdquo;</strong>, which expression shall, unless repugnant to the context, include its successors and permitted assigns).</p>

<p style="margin-top:8px;">Syncro1 and the Vendor are hereinafter individually referred to as a <strong>&ldquo;Party&rdquo;</strong> and collectively as the <strong>&ldquo;Parties.&rdquo;</strong></p>

<div class="divider"></div>

<!-- ==================== RECITALS ==================== -->
<div class="article-title">RECITALS</div>

<p class="clause" style="font-style:italic;"><strong>WHEREAS:</strong></p>
<p class="clause" style="font-style:italic;"><strong>A.</strong> Syncro1 operates a proprietary AI-driven digital staffing platform (the <strong>&ldquo;Platform&rdquo;</strong>) that connects client-employers with verified staffing partners for the purpose of recruitment and placement of professional candidates on an outcome-based, success-fee model.</p>
<p class="clause" style="font-style:italic;"><strong>B.</strong> The Vendor is engaged in the business of recruitment, staffing, and placement of candidates, and desires to participate on the Platform as an approved Staffing Partner to access Client Job Postings, submit Candidate profiles, and earn Commissions on Successful Placements.</p>
<p class="clause" style="font-style:italic;"><strong>C.</strong> The Parties intend that this Agreement shall exclusively govern the terms and conditions upon which the Vendor accesses and uses the Platform and participates in the recruitment ecosystem operated by Syncro1.</p>
<p class="clause" style="font-style:italic;"><strong>D.</strong> In consideration of the mutual covenants, representations, warranties, and obligations set forth herein, and for other good and valuable consideration, the sufficiency and receipt of which are hereby acknowledged, the Parties agree as follows.</p>

<!-- ==================== ARTICLE 1 ==================== -->
<div class="article-title">ARTICLE 1 &mdash;&mdash;&mdash; DEFINITIONS</div>

<p style="margin-bottom:6px;">In this Agreement, unless the context otherwise requires, the following terms shall have the meanings ascribed to them.</p>

<p class="clause"><strong>1.1 &ldquo;Agreement&rdquo;</strong> means this Master Staffing Partner (Vendor) Agreement together with all Schedules, Annexures, and any amendments executed by the Parties in writing from time to time, each of which is incorporated herein by reference.</p>

<p class="clause"><strong>1.2 &ldquo;Applicable Law&rdquo;</strong> means all statutes, regulations, rules, orders, directives, guidelines, and judicial or governmental decisions in force from time to time, including the Information Technology Act 2000, the Digital Personal Data Protection Act 2023, the Indian Contract Act 1872, the Arbitration and Conciliation Act 1996, the Companies Act 2013, and all applicable tax laws.</p>

<p class="clause"><strong>1.3 &ldquo;Candidate&rdquo;</strong> means any individual whose profile or resume is submitted by the Vendor through the Platform in response to a Job Posting, whether or not such individual is ultimately placed with a Client.</p>

<p class="clause"><strong>1.4 &ldquo;Client&rdquo;</strong> means any employer, company, or organisation registered on and approved by Syncro1 to post Job Postings and hire Candidates through the Platform. A Client is deemed &ldquo;introduced&rdquo; to the Vendor as soon as the Vendor views the relevant Client&rsquo;s Job Posting through the Platform.</p>

<p class="clause"><strong>1.5 &ldquo;Commission&rdquo;</strong> means the fee payable by Syncro1 to the Vendor upon each Successful Placement, calculated as <strong>five percent (5%)</strong> of the Candidate&rsquo;s fixed annual Cost to Company (CTC) as confirmed in the Candidate&rsquo;s offer letter, without any deduction or reference to any commission payable by the Client to Syncro1.</p>

<p class="clause"><strong>1.6 &ldquo;Confidential Information&rdquo;</strong> means any information disclosed by one Party to the other, whether orally, in writing, or electronically, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and the circumstances of disclosure, including Platform architecture, algorithms, AI models, source code, Client lists, Candidate data, financial data, commission structures, and pricing.</p>

<p class="clause"><strong>1.7 &ldquo;CTC&rdquo;</strong> means Cost to Company, being the total fixed annual compensation package offered by the Client to a Candidate, as confirmed in the Candidate&rsquo;s offer letter. Variable pay, bonuses, and non-cash benefits shall not be included in the fixed annual CTC.</p>

<p class="clause"><strong>1.8 &ldquo;Dispute&rdquo;</strong> means any disagreement, controversy, or claim arising out of, relating to, or in connection with this Agreement, including questions as to its existence, validity, interpretation, performance, breach, or termination.</p>

<p class="clause"><strong>1.9 &ldquo;Effective Date&rdquo;</strong> means the date on which the Vendor: (a) completes the online registration process; (b) successfully submits all KYC documents listed in Schedule E; and (c) receives written approval from Syncro1&rsquo;s Super Admin granting access to the Platform, as recorded in the Platform system log.</p>

<p class="clause"><strong>1.10 &ldquo;Force Majeure Event&rdquo;</strong> means any event beyond the reasonable control of the affected Party, including acts of God, natural disasters, war, terrorism, civil unrest, epidemic or pandemic declared by a governmental authority, fires, floods, governmental actions, or extended internet infrastructure failures not caused by the affected Party&rsquo;s own service providers.</p>

<p class="clause"><strong>1.11 &ldquo;Guarantee Period&rdquo;</strong> means the period of <strong>ninety (90) days</strong> from the Joining Date. During this period, if the Candidate&rsquo;s employment with the Client terminates for any reason (including resignation, termination by Client, or any other separation), the Vendor shall be obliged to provide a replacement Candidate as set out in Article 5.</p>

<p class="clause"><strong>1.12 &ldquo;Intellectual Property Rights&rdquo;</strong> means all intellectual property rights worldwide, including patents, trademarks, service marks, copyrights, design rights, database rights, trade secrets, know-how, and all applications for and renewals of such rights, whether registered or unregistered.</p>

<p class="clause"><strong>1.13 &ldquo;Job Posting&rdquo;</strong> means a validated and approved job opening created by a Client on the Platform and made visible to the Vendor, setting out the job description, screening questions, CTC range, and other relevant details.</p>

<p class="clause"><strong>1.14 &ldquo;Joining Date&rdquo;</strong> means the date on which a Candidate actually reports for duty and commences employment with the Client, as confirmed through the Platform by the Client or as deemed confirmed in accordance with Clause 5.8.</p>

<p class="clause"><strong>1.15 &ldquo;Platform&rdquo;</strong> means Syncro1&rsquo;s proprietary digital staffing technology platform, accessible via website, mobile applications, and APIs, including all software, AI tools, databases, workflows, analytics modules, communication channels, and all updates and modifications thereto.</p>

<p class="clause"><strong>1.16 &ldquo;Quality Check&rdquo;</strong> or <strong>&ldquo;QC&rdquo;</strong> means the multi-layered validation process performed by Syncro1&rsquo;s automated systems and Sub Admin team to assess Candidate submissions for completeness, authenticity, duplication, and alignment with Job Posting requirements before publication to the Client.</p>

<p class="clause"><strong>1.17 &ldquo;Service Level Agreement&rdquo;</strong> or <strong>&ldquo;SLA&rdquo;</strong> means the time-bound operational obligations of the Vendor as enumerated in Schedule B, non-compliance with which may result in consequences specified therein.</p>

<p class="clause"><strong>1.18 &ldquo;Sub Admin&rdquo;</strong> means Syncro1&rsquo;s internal operations team authorised to manage day-to-day Platform operations, perform QC, and coordinate between Clients, Vendors, and Candidates, but without authority over financial modules or MSA terms.</p>

<p class="clause"><strong>1.19 &ldquo;Successful Placement&rdquo;</strong> means the event in which: (a) a Candidate submitted by the Vendor through the Platform receives and accepts an offer of employment from a Client; (b) the Candidate reports for duty on the Joining Date; and (c) either the Client confirms the Candidate&rsquo;s joining through the Platform, or the Candidate completes seven (7) consecutive calendar days of employment with the Client without any objection raised by the Client through the Platform&rsquo;s dispute channel. If the Client fails to confirm or deny joining within seven (7) calendar days and no dispute is raised, the Candidate shall be deemed Successfully Placed by operation of this Agreement.</p>

<p class="clause"><strong>1.20 &ldquo;Super Admin&rdquo;</strong> means Syncro1&rsquo;s authorised executive-level administrator with full system authority including financial control, MSA management, dispute resolution, and suspension or termination of Platform users.</p>

<p class="clause"><strong>1.21 &ldquo;User Credentials&rdquo;</strong> means the unique login identification, password, two-factor authentication tokens, and all other access credentials issued to or created by the Vendor for accessing the Platform.</p>

<p class="clause"><strong>1.22 &ldquo;Vendor Content&rdquo;</strong> means all data, documents, resumes, messages, and materials uploaded or transmitted by the Vendor through the Platform, including Candidate profiles and communications.</p>

<!-- ==================== ARTICLE 2 ==================== -->
<div class="article-title">ARTICLE 2 &mdash;&mdash;&mdash; APPOINTMENT AND SCOPE OF ENGAGEMENT</div>

<p class="clause"><strong>2.1 Non-Exclusive Appointment.</strong> Syncro1 hereby appoints the Vendor as a non-exclusive, independent staffing partner for the limited purpose of sourcing and submitting Candidates through the Platform in response to Job Postings. Nothing herein prevents Syncro1 from engaging other vendors or sourcing Candidates through any other means at any time.</p>

<p class="clause"><strong>2.2 No Authority to Bind.</strong> The Vendor has no authority, express or implied, to make any representation or commitment on behalf of Syncro1, to enter into any agreement binding on Syncro1, or to act as agent for Syncro1 in any capacity. Any purported act by the Vendor to bind Syncro1 shall be void.</p>

<p class="clause"><strong>2.3 Independent Contractor.</strong> The Vendor is an independent contractor. Nothing herein creates a partnership, joint venture, agency, franchise, employment, or fiduciary relationship. The Vendor is solely responsible for its own employees, contractors, taxes, benefits, and operational expenses.</p>

<p class="clause"><strong>2.4 Platform Access Licence.</strong> Subject to the Vendor&rsquo;s compliance with this Agreement, Syncro1 grants the Vendor a limited, non-exclusive, non-transferable, non-sublicensable, revocable licence to access and use the Platform solely for the purpose of performing its obligations under this Agreement during the Term.</p>

<p class="clause"><strong>2.5 Platform Availability.</strong> Syncro1 shall use commercially reasonable efforts to maintain Platform availability of not less than 99% per calendar month, excluding scheduled maintenance windows notified at least 24 hours in advance and Force Majeure Events. Syncro1 does not warrant that the Platform will be error-free or uninterrupted.</p>

<p class="clause"><strong>2.6 Platform Changes.</strong> Syncro1 reserves the right to modify or update any feature of the Platform at any time. Material changes that adversely affect the Vendor&rsquo;s ability to submit Candidates or receive Commission shall be communicated with at least 15 days&rsquo; prior written notice.</p>

<!-- ==================== ARTICLE 3 ==================== -->
<div class="article-title">ARTICLE 3 &mdash;&mdash;&mdash; VENDOR OBLIGATIONS</div>

<p class="sub-title">3A. Registration, Onboarding, and KYC</p>

<p class="clause"><strong>3.1</strong> The Vendor shall complete the online registration process by providing accurate, current, and complete information including: full legal entity name; type and jurisdiction of incorporation; company registration number; GST registration number and certificate; registered office address; names and contact details of at least two authorised representatives; bank account details verified via penny-drop mechanism; and an escalation matrix.</p>

<p class="clause"><strong>3.2</strong> The Vendor shall upload all documents specified in Schedule E for KYC verification. Registration is subject to Sub Admin review and final Super Admin approval. Syncro1 reserves the right, in its absolute discretion, to reject any application or revoke approval at any time.</p>

<p class="clause"><strong>3.3</strong> The Vendor shall promptly update all changes to its registration information, including changes to authorised representatives, bank account, address, or regulatory status, within five (5) business days of such change. Failure to do so constitutes a material breach.</p>

<p class="clause"><strong>3.4</strong> The Vendor shall keep its User Credentials strictly confidential and not share them with any unauthorised person. The Vendor is solely responsible for all activities conducted through its account. The Vendor shall immediately notify Syncro1 in writing of any actual or suspected unauthorised access.</p>

<p class="sub-title">3B. Job Selection and Candidate Submission</p>

<p class="clause"><strong>3.5</strong> The Vendor shall only select Job Postings for which it has genuine capacity and expertise. The Vendor shall not select a Job Posting and leave it inactive for more than five (5) calendar days without submitting at least one Candidate, failing which the Vendor shall be automatically removed from that Job Posting and the inactivity recorded in its performance record.</p>

<p class="clause"><strong>3.6</strong> All Candidate submissions must be made exclusively through the Platform using the prescribed format and must include: full name; contact details (phone and email, hashed for duplication check); current CTC with supporting proof; expected CTC; notice period; resume; responses to all Client screening questions; and Candidate consent confirmation.</p>

<p class="clause"><strong>3.7</strong> The Vendor warrants that all information in a Candidate submission is, to the best of its knowledge, true, complete, and accurate. Prior to submission, the Vendor shall at minimum: (a) review the Candidate&rsquo;s LinkedIn profile and relevant online professional presence; (b) contact at least one previous employer listed on the Candidate&rsquo;s resume (with the Candidate&rsquo;s consent); and (c) review copies of educational certificates or verify qualifications through available online databases.</p>

<p class="clause"><strong>3.8 Candidate Consent.</strong> Prior to submission, the Vendor shall obtain the Candidate&rsquo;s explicit, informed, and freely given consent to: (a) submit the Candidate&rsquo;s profile to specific Clients through the Platform; (b) share the Candidate&rsquo;s personal data with Syncro1 and the relevant Client for recruitment purposes; and (c) receive communications via email and WhatsApp. Consent must be obtained through the Platform&rsquo;s designated consent mechanism. Consent records shall be retained for a minimum of three (3) years and produced to Syncro1 upon request within five (5) business days.</p>

<p class="clause"><strong>3.9 Duplicate Submissions.</strong> Syncro1 uses cryptographic hashing to detect duplicate Candidate submissions. The first chronologically valid submission of a Candidate for a specific Job Posting (that passes initial QC) shall be deemed the priority submission; all subsequent submissions of the same Candidate for the same Job Posting shall be automatically rejected.</p>

<p class="clause"><strong>3.10 Prohibited Conduct.</strong> The Vendor shall not: (a) submit Candidates without valid consent; (b) fabricate, alter, or misrepresent any Candidate data or credentials; (c) submit Candidates currently placed by Syncro1 with any Client without the Candidate&rsquo;s express written consent; or (d) share Job Posting details or Client information with any third party.</p>

<p class="sub-title">3C. Communication and Quality</p>

<p class="clause"><strong>3.11 PROHIBITION ON VENDOR-CLIENT COMMUNICATION.</strong> The Vendor shall not, under any circumstances, directly or indirectly communicate with, contact, meet, correspond, or otherwise interact with any Client of Syncro1 for any purpose whatsoever, whether through the Platform, by email, telephone, in person, or through any other medium. All communications with Clients regarding Candidates, Job Postings, interview scheduling, feedback, updates, or any other matter shall be conducted exclusively by Syncro1. Any breach of this Clause shall be deemed a material breach of this Agreement and a violation of Article 9.</p>

<p class="clause"><strong>3.12</strong> The Vendor shall respond to QC queries within four (4) business hours and shall keep Candidates informed of their application status in a timely manner. Failure to meet these SLAs shall be recorded and may adversely affect the Vendor&rsquo;s standing on the Platform.</p>

<p class="clause"><strong>3.13</strong> The Vendor shall comply with all Applicable Laws in its recruitment activities, including data protection laws, anti-discrimination laws, labour laws, and relevant employment agency regulations.</p>

<!-- ==================== ARTICLE 4 ==================== -->
<div class="article-title">ARTICLE 4 &mdash;&mdash;&mdash; REPRESENTATIONS AND WARRANTIES</div>

<p class="sub-title">4A. Vendor Representations and Warranties</p>
<p style="margin-bottom:6px;">The Vendor represents and warrants to Syncro1, on the Effective Date and on a continuing basis throughout the Term, that:</p>

<p class="clause"><strong>4.1</strong> It is duly organised, validly existing, and in good standing under the laws of its jurisdiction of incorporation or registration, and has full legal capacity and corporate authority to enter into and perform this Agreement.</p>
<p class="clause"><strong>4.2</strong> This Agreement, when executed, shall constitute a valid, binding, and enforceable obligation of the Vendor, subject to applicable insolvency and equitable principles.</p>
<p class="clause"><strong>4.3</strong> It has obtained, and shall maintain in good standing throughout the Term, all licences, registrations, and government approvals necessary to operate as a recruitment or staffing agency in its jurisdiction.</p>
<p class="clause"><strong>4.4</strong> It has full right, power, and authority to submit each Candidate&rsquo;s profile and has obtained all necessary consents and authorisations from each Candidate in accordance with Applicable Law.</p>
<p class="clause"><strong>4.5</strong> It has not and shall not infringe any third-party rights, including Intellectual Property Rights, privacy rights, or rights of personality, in connection with any Candidate submission or use of the Platform.</p>
<p class="clause"><strong>4.6</strong> All Candidate information submitted through the Platform has been collected lawfully, with appropriate notice and consent, and in compliance with Applicable Law, including the Digital Personal Data Protection Act 2023.</p>
<p class="clause"><strong>4.7</strong> It shall not engage in any fraudulent, deceptive, or unethical practices and has implemented adequate internal compliance procedures to uphold these standards.</p>
<p class="clause"><strong>4.8</strong> It has implemented and maintains adequate technical and organisational security measures to safeguard Candidate and Client information against unauthorised access, loss, destruction, or alteration.</p>

<p class="sub-title">4B. Syncro1 Representations and Warranties</p>
<p class="clause"><strong>4.9</strong> Syncro1 represents and warrants that: (a) it has the legal right and authority to operate the Platform and to grant the licences set out herein; (b) the Platform, when used as authorised, does not infringe any third-party Intellectual Property Rights of which Syncro1 is aware as at the Effective Date; and (c) it shall use commercially reasonable efforts to vet Clients and maintain a professionally operated Platform.</p>

<!-- ==================== ARTICLE 5 ==================== -->
<div class="article-title">ARTICLE 5 &mdash;&mdash;&mdash; COMMISSION, PAYOUT, AND REPLACEMENT OBLIGATIONS</div>

<p class="sub-title">5A. Commission Structure</p>
<p class="clause"><strong>5.1</strong> Syncro1 shall pay the Vendor a Commission for each Successful Placement, calculated as <strong>five percent (5%)</strong> of the Candidate&rsquo;s fixed annual CTC as confirmed in the Candidate&rsquo;s offer letter. The Commission is fixed and shall not be affected by any arrangement, discount, or commission percentage between Syncro1 and the Client.</p>
<p class="clause"><strong>5.2 Contingency.</strong> Commission is payable only upon Successful Placement. No Commission is payable in respect of a Candidate who does not join the Client, or whose joining is disputed by the Client in good faith and ultimately unconfirmed through the Platform&rsquo;s dispute resolution process.</p>

<p class="sub-title">5B. Payout Terms</p>
<p class="clause"><strong>5.3</strong> Syncro1 shall pay the Commission to the Vendor within <strong>ninety (90) days</strong> following the Joining Date, regardless of whether Syncro1 has received payment from the Client. The Commission shall be paid net of applicable tax deductions at source (TDS) as required by Applicable Law.</p>
<p class="clause"><strong>5.4</strong> Payouts shall be made to the Vendor&rsquo;s verified bank account via NEFT/RTGS or other electronic means. The Vendor bears all costs arising from incorrect bank details. Syncro1 shall not be liable for delays caused by the Vendor&rsquo;s failure to provide accurate account information.</p>
<p class="clause"><strong>5.5</strong> Before processing each payout, the Vendor shall upload a valid, compliant GST invoice to the Platform. Syncro1 may withhold payout until such invoice is received.</p>

<p class="sub-title">5C. Replacement Obligation (Guarantee Period)</p>
<p class="clause"><strong>5.6</strong> If, during the Guarantee Period of <strong>ninety (90) days</strong> from the Joining Date, the Candidate&rsquo;s employment with the Client terminates for any reason whatsoever (including resignation, termination by Client, layoff, or any other separation), the Vendor shall, upon written notice from Syncro1, provide a replacement Candidate for the same Job Posting.</p>
<p class="clause"><strong>5.7</strong> The Vendor shall commence the replacement process and submit at least one (1) suitable replacement Candidate within <strong>fifteen (15) days</strong> of receiving the written notice from Syncro1. The replacement Candidate must meet the same job requirements and qualifications as the original Job Posting.</p>
<p class="clause"><strong>5.8</strong> If the Vendor fails to provide a replacement Candidate within the stipulated fifteen (15) days, Syncro1 may, at its sole discretion, engage another vendor to source a replacement, and the Vendor shall reimburse Syncro1 for any reasonable costs incurred in sourcing such replacement, or Syncro1 may recover such costs by adjusting against any pending Commission payable to the Vendor.</p>
<p class="clause"><strong>5.9</strong> For the avoidance of doubt, no Replacement Fund or any withholding from the Commission shall be made by Syncro1. The Commission for the original placement is fully earned and payable as per Clause 5.3, regardless of any subsequent replacement obligation.</p>

<p class="sub-title">5D. Taxes</p>
<p class="clause"><strong>5.10</strong> All Commission amounts are exclusive of applicable taxes. The Vendor is responsible for all taxes on its income, including GST, and shall issue a compliant tax invoice to Syncro1 for each payout. Syncro1 shall deduct tax at source (TDS) as required by Applicable Law and provide the Vendor with a TDS certificate within the statutory timelines.</p>

<!-- ==================== ARTICLE 6 ==================== -->
<div class="article-title">ARTICLE 6 &mdash;&mdash;&mdash; INTELLECTUAL PROPERTY</div>

<p class="clause"><strong>6.1 Platform Ownership.</strong> Syncro1 retains all right, title, and interest in and to the Platform and all associated Intellectual Property Rights, including source code, algorithms, AI models, databases, user interfaces, proprietary workflows, and all modifications and derivatives thereof. No ownership or right is transferred to the Vendor under this Agreement except the limited access licence in Clause 2.4.</p>
<p class="clause"><strong>6.2 Restrictions.</strong> The Vendor shall not, and shall not permit any third party to: (a) copy, reproduce, reverse engineer, decompile, or disassemble any part of the Platform; (b) modify, adapt, or create derivative works of the Platform; (c) access the Platform to build a competing product; (d) scrape or extract data from the Platform by automated means; or (e) remove or alter any proprietary notices on the Platform.</p>
<p class="clause"><strong>6.3 Vendor Content Licence.</strong> The Vendor retains ownership of Vendor Content. By uploading Vendor Content to the Platform, the Vendor grants Syncro1 a worldwide, non-exclusive, royalty-free, fully paid-up, sublicensable licence to host, store, reproduce, process, display, and use such Vendor Content solely to: (a) operate and improve the Platform; and (b) train and enhance Syncro1&rsquo;s AI models using aggregated and anonymised data.</p>
<p class="clause"><strong>6.4 Feedback.</strong> Any feedback, suggestions, or enhancement requests provided by the Vendor to Syncro1 regarding the Platform shall be deemed a non-exclusive, royalty-free, perpetual licence to Syncro1 to use such feedback without any obligation or compensation to the Vendor.</p>

<!-- ==================== ARTICLE 7 ==================== -->
<div class="article-title">ARTICLE 7 &mdash;&mdash;&mdash; CONFIDENTIALITY</div>

<p class="clause"><strong>7.1 Obligation.</strong> Each Party shall hold the other Party&rsquo;s Confidential Information in strict confidence and shall not disclose it to any person except: (a) to its employees, directors, advisors, or contractors who need to know such information for the performance of this Agreement and who are bound by confidentiality obligations no less protective than those in this Article; or (b) as required by Applicable Law, court order, or regulatory authority.</p>
<p class="clause"><strong>7.2 Compelled Disclosure.</strong> If a Party is legally compelled to disclose Confidential Information, it shall: (a) provide the other Party with prompt prior written notice (to the extent legally permissible) to afford it the opportunity to seek a protective order; and (b) disclose only so much as is strictly required.</p>
<p class="clause"><strong>7.3 Exclusions.</strong> Confidentiality obligations do not apply to information that: (a) is or becomes publicly available through no act or omission of the Receiving Party; (b) was rightfully known to the Receiving Party prior to disclosure; (c) is independently developed by the Receiving Party; or (d) is rightfully received from a third party without restriction.</p>
<p class="clause"><strong>7.4 Security.</strong> Each Party shall implement industry-standard technical and organisational security measures to protect the other Party&rsquo;s Confidential Information from unauthorised access, use, alteration, or destruction.</p>
<p class="clause"><strong>7.5 Survival.</strong> Obligations under this Article shall survive termination or expiry of this Agreement for five (5) years, except with respect to trade secrets, which shall be protected for as long as they qualify as trade secrets under Applicable Law.</p>

<!-- ==================== ARTICLE 8 ==================== -->
<div class="article-title">ARTICLE 8 &mdash;&mdash;&mdash; DATA PROTECTION AND PRIVACY</div>

<p class="clause"><strong>8.1 Compliance.</strong> Each Party shall comply with all Applicable Laws governing the collection, storage, processing, sharing, and deletion of personal data, including the Digital Personal Data Protection Act 2023 and all associated rules and regulations.</p>
<p class="clause"><strong>8.2 Data Controller.</strong> For Candidate data collected and submitted by the Vendor, the Vendor is an independent data controller solely responsible for ensuring a valid legal basis for processing, providing appropriate privacy notices to Candidates, and honouring data subject rights.</p>
<p class="clause"><strong>8.3 Vendor Data Obligations.</strong> The Vendor shall: (a) collect, use, and process Candidate data only for recruitment through the Platform and for no other purpose; (b) not retain Candidate data beyond the period necessary for such purpose; (c) promptly assist Syncro1 in responding to data subject requests relating to Candidates submitted by the Vendor; and (d) notify Syncro1 in writing within 72 hours of becoming aware of any data breach affecting Candidate or Client data.</p>
<p class="clause"><strong>8.4 Deletion on Termination.</strong> Within 30 days following termination or expiry of this Agreement, the Vendor shall securely delete or return all personal data of Candidates and Clients obtained through the Platform, except to the extent retention is required by Applicable Law.</p>
<p class="clause"><strong>8.5</strong> The detailed data processing terms, categories of data processed, sub-processor list, security measures, and breach notification procedures are set out in Schedule C, which forms an integral part of this Agreement.</p>

<!-- ==================== ARTICLE 9 ==================== -->
<div class="article-title">ARTICLE 9 &mdash;&mdash;&mdash; NON-CIRCUMVENTION, NON-SOLICITATION, AND PROHIBITION ON CLIENT CONTACT</div>

<p class="clause"><strong>9.1 Prohibition on Contacting Clients.</strong> The Vendor irrevocably agrees that during the Term and for a period of <strong>twenty-four (24) months</strong> following the termination or expiry of this Agreement, it shall not, directly or indirectly, for any reason whatsoever:</p>
<ul class="bullet-list">
  <li>(a) contact, communicate with, meet, call, email, or otherwise interact with any Client of Syncro1 (including any Client whose Job Posting the Vendor viewed or accessed through the Platform);</li>
  <li>(b) solicit, engage, or attempt to do any business, recruitment, staffing, or human resources services with any such Client outside the Platform;</li>
  <li>(c) place any Candidate (whether submitted through the Platform or otherwise) with any such Client without routing the placement through Syncro1;</li>
  <li>(d) encourage, induce, or facilitate any Client to circumvent or bypass the Platform for any transaction;</li>
  <li>(e) obtain or attempt to obtain any Client&rsquo;s contact information, identity, or business details from any source for the purpose of circumventing this prohibition.</li>
</ul>
<p class="clause"><strong>9.2 Definition of Introduction.</strong> A Client is deemed &ldquo;introduced&rdquo; through the Platform if the Vendor accessed or viewed the Client&rsquo;s Job Posting, or if the Vendor submitted any Candidate in response to a Job Posting posted by that Client. The Vendor acknowledges that the identity of Clients is Confidential Information of Syncro1. The Vendor shall not attempt to prove &ldquo;prior independent knowledge&rdquo; of any Client as a defence to breach of this Article; any such claim shall be void ab initio.</p>
<p class="clause"><strong>9.3 Prohibition on Doing Business with Syncro1 Clients.</strong> The Vendor shall not, during the Term and for twenty-four (24) months thereafter, directly or indirectly, provide recruitment, staffing, placement, or any related services to any Client of Syncro1, regardless of whether the Vendor claims to have known such Client independently. This prohibition applies even if the Vendor learns of a Client through sources other than the Platform.</p>
<p class="clause"><strong>9.4 Liquidated Damages.</strong> In the event of any breach of this Article, the Vendor shall pay Syncro1, as liquidated damages, a sum equal to <strong>three (3) times</strong> the Commission that would have been payable to Syncro1 had the relevant placement been made through the Platform. In addition, the Vendor shall pay to Syncro1 an amount equal to <strong>fifty percent (50%)</strong> of any fees or consideration received by the Vendor from such Client in connection with any prohibited transaction. The Vendor shall also reimburse all reasonable legal fees, investigation costs, and enforcement expenses incurred by Syncro1.</p>
<p class="clause"><strong>9.5 Injunctive Relief.</strong> The Vendor acknowledges that any breach of this Article would cause irreparable harm to Syncro1 for which monetary damages would be inadequate. Syncro1 shall be entitled to seek injunctive or other equitable relief from any competent court without posting bond and without prejudice to any other rights or remedies.</p>
<p class="clause"><strong>9.6 Non-Solicitation of Personnel.</strong> During the Term and for 12 months thereafter, neither Party shall directly or indirectly solicit, recruit, or hire any employee or key contractor of the other Party who was involved in the performance of this Agreement, without the other Party&rsquo;s prior written consent.</p>

<!-- ==================== ARTICLE 10 ==================== -->
<div class="article-title">ARTICLE 10 &mdash;&mdash;&mdash; INDEMNIFICATION</div>

<p class="clause"><strong>10.1 Vendor Indemnity.</strong> The Vendor shall indemnify, defend, and hold harmless Syncro1, its affiliates, directors, officers, employees, and agents from and against any and all third-party claims, actions, damages, losses, liabilities, costs, and expenses (including reasonable attorneys&rsquo; fees) arising out of or relating to: (a) any breach by the Vendor of any representation, warranty, covenant, or obligation under this Agreement; (b) any false, fabricated, or materially inaccurate information provided by the Vendor in any Candidate submission; (c) the Vendor&rsquo;s failure to obtain or maintain required Candidate consents; (d) any claim by a Candidate arising from the Vendor&rsquo;s recruitment activities; (e) the Vendor&rsquo;s violation of Applicable Law; (f) any data breach caused by the Vendor&rsquo;s negligence or failure to implement adequate security measures; or (g) any breach of Article 9.</p>
<p class="clause"><strong>10.2 Reduction for Syncro1 Fault.</strong> The Vendor&rsquo;s indemnity obligation shall be reduced proportionally to the extent that a court or arbitral tribunal determines that Syncro1&rsquo;s own negligence, breach, or misconduct materially contributed to the relevant claim.</p>
<p class="clause"><strong>10.3 Syncro1 Indemnity.</strong> Syncro1 shall indemnify and hold harmless the Vendor from any third-party claim that the Platform, when used by the Vendor within the scope of this Agreement and in accordance with Syncro1&rsquo;s instructions, infringes a registered Intellectual Property Right in India.</p>
<p class="clause"><strong>10.4 Procedure.</strong> The Party seeking indemnification shall: (a) promptly notify the indemnifying Party in writing of any claim; (b) grant the indemnifying Party reasonable control of the defence and settlement (provided no settlement imposing obligations on the indemnified Party shall be agreed without its prior written consent); and (c) cooperate reasonably in the defence at the indemnifying Party&rsquo;s cost.</p>

<!-- ==================== ARTICLE 11 ==================== -->
<div class="article-title">ARTICLE 11 &mdash;&mdash;&mdash; LIMITATION OF LIABILITY</div>

<p class="clause"><strong>11.1 Liability Cap.</strong> TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, SYNCRO1&rsquo;S TOTAL AGGREGATE LIABILITY TO THE VENDOR ARISING OUT OF OR IN CONNECTION WITH THIS AGREEMENT, WHETHER IN CONTRACT, TORT (INCLUDING NEGLIGENCE), BREACH OF STATUTORY DUTY, OR OTHERWISE, SHALL NOT EXCEED THE TOTAL COMMISSION AMOUNTS ACTUALLY PAID BY SYNCRO1 TO THE VENDOR DURING THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, PROVIDED THAT SUCH CAP SHALL IN NO EVENT BE LESS THAN INR 25,000 (INDIAN RUPEES TWENTY-FIVE THOUSAND) IN RESPECT OF ANY SINGLE CLAIM.</p>
<p class="clause"><strong>11.2 Exclusion of Consequential Damages.</strong> IN NO EVENT SHALL EITHER PARTY BE LIABLE TO THE OTHER FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, LOSS OF REVENUE, LOSS OF GOODWILL, LOSS OF DATA, BUSINESS INTERRUPTION, OR COST OF PROCUREMENT OF SUBSTITUTE SERVICES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES, HOWSOEVER ARISING.</p>
<p class="clause"><strong>11.3 Exceptions.</strong> The limitations in Clauses 11.1 and 11.2 shall not apply to: (a) liability arising from a Party&rsquo;s fraud, gross negligence, or wilful misconduct; (b) indemnification obligations under Article 10; (c) breach of Article 7 (Confidentiality) or Article 9 (Non-Circumvention); or (d) liability that cannot be limited by Applicable Law.</p>
<p class="clause"><strong>11.4 Risk Allocation.</strong> The Parties acknowledge that the liability limitations reflect a reasonable allocation of risk and form an essential basis of the bargain, without which Syncro1 would not have entered into this Agreement.</p>

<!-- ==================== ARTICLE 12 ==================== -->
<div class="article-title">ARTICLE 12 &mdash;&mdash;&mdash; AUDIT AND RECORD-KEEPING</div>

<p class="clause"><strong>12.1</strong> Syncro1 may, upon ten (10) business days&rsquo; prior written notice, audit the Vendor&rsquo;s records relating to Candidate sourcing practices, consent records, data handling, and compliance with this Agreement, either through its own personnel or through a reputable third-party auditor bound by equivalent confidentiality obligations. Syncro1 may conduct no more than one (1) routine audit per calendar year, unless there is reasonable suspicion of material breach or fraud.</p>
<p class="clause"><strong>12.2</strong> The Vendor shall cooperate fully with any audit and shall produce all requested documents and information within seven (7) business days of the written request. Non-cooperation within this period constitutes a material breach.</p>
<p class="clause"><strong>12.3</strong> The Vendor shall maintain accurate and complete records relevant to its performance under this Agreement for a minimum of three (3) years following expiry or termination, or such longer period as required by Applicable Law.</p>
<p class="clause"><strong>12.4</strong> Audit costs shall be borne by Syncro1 unless the audit reveals a material breach by the Vendor, in which case the Vendor shall reimburse Syncro1 for the reasonable audit costs.</p>

<!-- ==================== ARTICLE 13 ==================== -->
<div class="article-title">ARTICLE 13 &mdash;&mdash;&mdash; SERVICE LEVEL AGREEMENTS AND PERFORMANCE MONITORING</div>

<p class="clause"><strong>13.1</strong> The Vendor&rsquo;s compliance with the Service Level Agreements set out in Schedule B shall be continuously monitored through Syncro1&rsquo;s systems. SLA breaches shall be recorded and may result in consequences as set out in Schedule B.</p>
<p class="clause"><strong>13.2</strong> Syncro1 shall provide the Vendor with a monthly performance report through the Platform Dashboard, setting out any SLA breaches and the Vendor&rsquo;s overall compliance record.</p>
<p class="clause"><strong>13.3</strong> The Vendor may dispute any SLA breach record within 15 days of the monthly report by submitting a written appeal with supporting evidence through the Platform. Sub Admin shall review and respond within 7 business days. If unsatisfied, the Vendor may escalate to Super Admin within 7 days, whose decision shall be final.</p>
<p class="clause"><strong>13.4</strong> If the Vendor repeatedly or materially fails to meet the SLAs in Schedule B, Syncro1 may issue a formal performance warning with a 30-day improvement plan. If the Vendor fails to materially improve within the improvement period, Syncro1 may terminate this Agreement in accordance with Clause 14.4(c).</p>

<!-- ==================== ARTICLE 14 ==================== -->
<div class="article-title">ARTICLE 14 &mdash;&mdash;&mdash; TERM AND TERMINATION</div>

<p class="clause"><strong>14.1 Term.</strong> This Agreement shall commence on the Effective Date and continue until terminated by either Party in accordance with this Article.</p>
<p class="clause"><strong>14.2 Termination for Convenience.</strong> Either Party may terminate this Agreement without cause by giving not less than <strong>30 (thirty) days&rsquo;</strong> prior written notice. On expiry of the notice period, the Vendor&rsquo;s Platform access shall cease, provided that any Commission validly earned prior to the effective date of termination shall continue to be paid subject to Article 5.</p>
<p class="clause"><strong>14.3 Termination by Vendor for Cause.</strong> The Vendor may terminate immediately upon written notice to Syncro1 if Syncro1 commits a material breach and fails to remedy it within 15 business days of receiving written notice particularising the breach.</p>
<p class="clause"><strong>14.4 Termination by Syncro1 for Cause.</strong> Syncro1 may terminate immediately upon written notice if: (a) the Vendor commits a material breach and fails to remedy it within 15 business days of written notice (provided that no cure period shall apply to breaches of Article 9, Clause 3.10, Clause 3.11, or Article 8); (b) the Vendor submits fabricated, fraudulent, or materially misrepresented Candidate profiles; (c) the Vendor repeatedly or materially fails to meet SLA requirements after receiving a performance warning and improvement plan under Clause 13.4; (d) the Vendor becomes insolvent, makes an assignment for the benefit of creditors, is subject to voluntary or involuntary insolvency proceedings, or ceases to carry on business; or (e) the Vendor breaches Article 9 (Non-Circumvention and Prohibition on Client Contact).</p>
<p class="clause"><strong>14.5 Effect of Termination.</strong> Upon termination or expiry for any reason: (a) the Vendor&rsquo;s Platform access and all licences granted herein immediately terminate; (b) all outstanding Commission amounts validly earned in respect of Successful Placements prior to termination shall be settled within 30 days, subject to any pending replacement obligations or fraud investigation; (c) any Candidate shortlisted, interviewed, or offered a position prior to the termination date remains eligible for Commission if placed within 90 days, during which period the Vendor retains limited read-only Platform access to track such Candidates; (d) each Party shall promptly return or securely destroy the other Party&rsquo;s Confidential Information; and (e) all provisions that by their nature should survive shall survive, including Articles 6, 7, 8, 9, 10, 11, 12, 15, and 16.</p>

<!-- ==================== ARTICLE 15 ==================== -->
<div class="article-title">ARTICLE 15 &mdash;&mdash;&mdash; DISPUTE RESOLUTION</div>

<p class="clause"><strong>15.1 Good Faith Negotiations.</strong> In the event of any Dispute, the Parties shall first attempt resolution through good faith management-level discussions. Either Party may initiate this by delivering a written notice of Dispute setting out the nature of the Dispute and the relief sought.</p>
<p class="clause"><strong>15.2 Internal Escalation.</strong> If unresolved within 10 business days of the notice, the Dispute shall be submitted through the Platform&rsquo;s dispute resolution tool (for automated preliminary determination within 24 hours), then escalated to Sub Admin for mediation within 48 hours, and then (if still unresolved) to Super Admin for a final administrative determination within 7 business days. Pending resolution, the Parties shall continue to perform their obligations.</p>
<p class="clause"><strong>15.3 Arbitration.</strong> If unresolved through the process in Clauses 15.1 and 15.2 within 30 days, or if either Party elects in writing to bypass internal escalation, either Party may refer the Dispute to final and binding arbitration under the Arbitration and Conciliation Act, 1996, as amended. The arbitration shall be conducted by a sole arbitrator appointed by mutual agreement or, failing agreement within 15 days, by the appropriate court. The seat and venue of arbitration shall be <strong>Mumbai, Maharashtra</strong>. The language shall be English. The arbitrator&rsquo;s award shall be final, binding, and enforceable. All proceedings shall be kept strictly confidential.</p>
<p class="clause"><strong>15.4 Individual Basis.</strong> Arbitration shall be conducted on an individual basis only. The Vendor irrevocably waives any right to participate in any class, consolidated, or representative proceeding.</p>
<p class="clause"><strong>15.5 Injunctive Relief.</strong> Either Party may seek urgent interim injunctive or other equitable relief from a competent court without prior recourse to escalation or arbitration, where necessary to prevent irreparable harm or preserve the status quo pending arbitration.</p>
<p class="clause"><strong>15.6 Governing Law.</strong> This Agreement shall be governed by and construed in accordance with the <strong>laws of India</strong>, without regard to its conflict of laws principles.</p>
<p class="clause"><strong>15.7 Jurisdiction.</strong> Subject to Clause 15.3, the courts in <strong>Mumbai, Maharashtra</strong> shall have exclusive jurisdiction over matters arising under this Agreement not required to be referred to arbitration.</p>
<p class="clause"><strong>15.8 Costs.</strong> The prevailing party in any arbitration or litigation shall be entitled to recover reasonable legal costs and arbitral fees from the non-prevailing party.</p>

<!-- ==================== ARTICLE 16 ==================== -->
<div class="article-title">ARTICLE 16 &mdash;&mdash;&mdash; FORCE MAJEURE</div>

<p class="clause"><strong>16.1</strong> Neither Party shall be in breach, nor liable for any failure or delay in performance, to the extent such failure or delay is caused by a Force Majeure Event, provided that: (a) the affected Party notifies the other in writing within 5 business days of the occurrence, describing the nature and expected duration; (b) the affected Party uses reasonable endeavours to mitigate the impact and resume performance; and (c) the Force Majeure Event is not caused by the affected Party&rsquo;s own act or omission.</p>
<p class="clause"><strong>16.2</strong> If a Force Majeure Event continues for more than 30 consecutive days, either Party may terminate this Agreement upon 7 days&rsquo; written notice without liability, other than for amounts accrued and due prior to the Force Majeure Event.</p>
<p class="clause"><strong>16.3</strong> Financial hardship, inability to meet agreed Commission splits, or general market downturns shall not constitute Force Majeure Events.</p>

<!-- ==================== ARTICLE 17 ==================== -->
<div class="article-title">ARTICLE 17 &mdash;&mdash;&mdash; GENERAL PROVISIONS</div>

<p class="clause"><strong>17.1 Entire Agreement.</strong> This Agreement (including all Schedules and Annexures) constitutes the entire agreement between the Parties with respect to its subject matter and supersedes all prior agreements, negotiations, representations, and understandings, whether written or oral, relating thereto.</p>
<p class="clause"><strong>17.2 Amendments.</strong> No amendment or modification of this Agreement shall be valid unless in writing and signed by duly authorised representatives of both Parties. Syncro1 may update the Schedules (including SLAs) by providing 30 days&rsquo; prior written notice. Any proposed change that materially and adversely affects the Vendor&rsquo;s economic position shall require the Vendor&rsquo;s express written consent. If the Vendor does not consent within 30 days, the change shall not apply to the Vendor, but Syncro1 may thereafter terminate this Agreement with 60 days&rsquo; notice.</p>
<p class="clause"><strong>17.3 Waiver.</strong> No failure or delay in exercising any right or remedy shall constitute a waiver thereof. A waiver of any breach shall not constitute a waiver of any subsequent breach.</p>
<p class="clause"><strong>17.4 Severability.</strong> If any provision is held to be invalid, illegal, or unenforceable, it shall be modified to the minimum extent necessary or, if not possible, severed, and the remaining provisions shall continue in full force and effect.</p>
<p class="clause"><strong>17.5 Assignment.</strong> The Vendor may not assign, transfer, novate, or sub-contract this Agreement or any rights or obligations hereunder without Syncro1&rsquo;s prior written consent. Syncro1 may assign this Agreement without consent in connection with a merger, acquisition, amalgamation, or sale of all or substantially all of its assets or business, upon written notice to the Vendor. Any attempted assignment in violation of this Clause shall be void.</p>
<p class="clause"><strong>17.6 Notices.</strong> All notices under this Agreement shall be in writing and delivered: (a) by hand or courier to the registered address of the relevant Party; or (b) by email to the addresses provided during Platform registration (or as updated in writing). Email notices shall be deemed received 24 hours after sending, unless a delivery failure notification is received.</p>
<p class="clause"><strong>17.7 Relationship.</strong> The Parties are independent contractors. Nothing in this Agreement creates a partnership, joint venture, agency, employment, or franchise relationship. The Vendor shall not represent itself as agent or employee of Syncro1.</p>
<p class="clause"><strong>17.8 Third-Party Rights.</strong> Except as expressly set out herein, this Agreement does not create any rights in favour of any third party. Clients are intended third-party beneficiaries solely in respect of the Vendor&rsquo;s obligations concerning Candidate quality, accuracy, and consent in Articles 3, 4, and 8.</p>
<p class="clause"><strong>17.9 Counterparts and Electronic Signatures.</strong> This Agreement may be executed in counterparts, including by digital or electronic signature (which the Parties hereby agree shall have the same legal effect as a wet-ink signature). Each counterpart shall be an original and all counterparts together shall constitute one binding instrument.</p>
<p class="clause"><strong>17.10 Language.</strong> This Agreement is drafted and executed in English. In the event of any conflict between an English version and any translation, the English version shall prevail.</p>
<p class="clause"><strong>17.11 Headings.</strong> Article and clause headings are for convenience only and shall not affect the interpretation of this Agreement.</p>

<!-- ==================== SIGNATURES ==================== -->
<div class="sig-section">
  <div class="divider"></div>
  <h3>SIGNATURES</h3>
  <p class="witness-text">IN WITNESS WHEREOF, the Parties have executed this Master Staffing Partner (Vendor) Agreement as of the date first written above, by their duly authorised representatives.</p>

  <table style="border:1.5px solid #000; width:100%; border-collapse:collapse;">
    <tr>
      <td style="width:50%; padding:16px 18px; border-right:1.5px solid #000; vertical-align:top;">
        <p style="font-size:8.5pt; font-weight:bold; text-transform:uppercase; color:#444; margin-bottom:2px;">FOR AND ON BEHALF OF</p>
        <p style="font-size:10.5pt; font-weight:bold; text-transform:uppercase; margin-bottom:14px;">SYNCRO1 TECHNOLOGIES PRIVATE LIMITED</p>

        <p style="font-size:9pt; font-weight:bold; margin-bottom:4px;">Signature:</p>
        <div style="border:1px solid #000; height:55px; margin-bottom:10px; background:#fafafa;"></div>

        <p style="font-size:9.5pt; margin-bottom:5px;">Name: <span style="display:inline-block; min-width:160px; border-bottom:1px solid #000;">&nbsp;</span></p>
        <p style="font-size:9.5pt; margin-bottom:5px;">Designation: <span style="display:inline-block; min-width:140px; border-bottom:1px solid #000;">&nbsp;</span></p>
        <p style="font-size:9.5pt; margin-bottom:5px;">Date: <strong>${formattedDate}</strong></p>
        <p style="font-size:9.5pt;">Place: <strong>Mumbai, Maharashtra</strong></p>
      </td>
      <td style="width:50%; padding:16px 18px; vertical-align:top;">
        <p style="font-size:8.5pt; font-weight:bold; text-transform:uppercase; color:#444; margin-bottom:2px;">FOR AND ON BEHALF OF</p>
        <p style="font-size:10.5pt; font-weight:bold; text-transform:uppercase; margin-bottom:14px;">${vendorLegalName}</p>

        <p style="font-size:9pt; font-weight:bold; margin-bottom:4px;">Digital Signature:</p>
        <div style="border:1px solid #000; padding:6px 10px; margin-bottom:10px; background:#f0f4ff; min-height:55px;">
          <p style="font-family:'Palatino Linotype', Palatino, serif; font-size:20pt; font-style:italic; color:#1a1a8c; font-weight:bold; line-height:1.2;">${digitalSignature || signatoryName}</p>
          <p style="font-size:7.5pt; color:#555; border-top:0.5px dotted #aaa; padding-top:3px; margin-top:3px;">
            Digitally signed by: ${signatoryName} &nbsp;|&nbsp; ${signedDateTime} &nbsp;|&nbsp; IP: ${signedIp || 'N/A'}
          </p>
        </div>

        <p style="font-size:9.5pt; margin-bottom:5px;">Name: <strong>${signatoryName}</strong></p>
        <p style="font-size:9.5pt; margin-bottom:5px;">Designation: <strong>${designation || 'N/A'}</strong></p>
        <p style="font-size:9.5pt; margin-bottom:5px;">Date: <strong>${formattedDate}</strong></p>
        <p style="font-size:9.5pt;">Place: <strong>${city || 'N/A'}, ${state || 'N/A'}</strong></p>
      </td>
    </tr>
  </table>

  <div style="margin-top:12px; padding:8px 12px; border:0.5px solid #999; background:#f8f8f8; font-size:8.5pt; font-style:italic; text-align:center;">
    The undersigned represent and warrant that they are duly authorised to execute this Agreement on behalf of their respective entities and to bind such entities to its terms.
  </div>
</div>

<!-- ==================== SCHEDULE A ==================== -->
<div class="schedule-title">SCHEDULE A &mdash;&mdash;&mdash; COMMISSION STRUCTURE</div>
<p style="font-style:italic; margin-bottom:8px; text-align:center;">This Schedule forms an integral part of the Agreement.</p>

<p class="sub-title">A1. Standard Commission</p>
<p class="clause">The Vendor shall receive a Commission equal to <strong>five percent (5%)</strong> of the Candidate&rsquo;s fixed annual CTC (as confirmed in the offer letter issued by the Client) for each Successful Placement.</p>
<p class="clause"><em>Example: If a Candidate&rsquo;s fixed annual CTC is INR 10,00,000 (Ten Lakhs), the Commission payable to the Vendor shall be INR 50,000 (Fifty Thousand Rupees).</em></p>

<p class="sub-title">A2. No Deductions or Adjustments</p>
<p class="clause">The Commission is fixed and shall not be reduced or affected by:</p>
<ul class="bullet-list">
  <li>Any discount, rebate, or special arrangement between Syncro1 and the Client;</li>
  <li>Any commission percentage or fee structure agreed between Syncro1 and the Client;</li>
  <li>Any Replacement Fund (no such fund exists under this Agreement);</li>
  <li>Any tier or performance classification (no tier system exists under this Agreement).</li>
</ul>

<p class="sub-title">A3. Payout Timing</p>
<p class="clause">Commission shall be paid within <strong>ninety (90) days</strong> following the Joining Date, regardless of whether Syncro1 has received payment from the Client.</p>

<p class="sub-title">A4. Rate Card Changes</p>
<p class="clause">Syncro1 may revise the Commission percentage only by providing 30 days&rsquo; written notice. Any reduction in the Commission percentage requires the Vendor&rsquo;s express written consent; failing such consent, Syncro1 may terminate this Agreement with 60 days&rsquo; notice.</p>

<!-- ==================== SCHEDULE B ==================== -->
<div class="schedule-title">SCHEDULE B &mdash;&mdash;&mdash; VENDOR SERVICE LEVEL AGREEMENTS (SLAs)</div>
<p style="margin-bottom:8px;">The Vendor agrees to comply with the following SLAs. Breaches are recorded in the Vendor&rsquo;s monthly performance report.</p>

<table>
  <tr>
    <th style="width:35%;">Obligation</th>
    <th style="width:20%;">Deadline</th>
    <th style="width:45%;">Consequence of Breach</th>
  </tr>
  <tr>
    <td>Response to QC queries</td>
    <td>4 business hours</td>
    <td>Candidate submission may be rejected; SLA failure recorded.</td>
  </tr>
  <tr>
    <td>Submission of additional documents requested by QC</td>
    <td>24 hours from request</td>
    <td>Payout delayed until documents received; SLA failure recorded.</td>
  </tr>
  <tr>
    <td>GST invoice upload after Successful Placement</td>
    <td>3 business days from Joining Date confirmation</td>
    <td>Payout withheld until invoice received.</td>
  </tr>
  <tr>
    <td>Inactivity on an accepted Job Posting (no Candidate submitted)</td>
    <td>5 calendar days from job acceptance</td>
    <td>Vendor automatically removed from that Job Posting; inactivity flagged.</td>
  </tr>
  <tr>
    <td>Force Majeure notification</td>
    <td>5 business days of occurrence</td>
    <td>Loss of Force Majeure protection for the delayed period.</td>
  </tr>
  <tr>
    <td>Data breach notification to Syncro1</td>
    <td>72 hours of becoming aware</td>
    <td>Potential indemnity liability and regulatory non-compliance risk.</td>
  </tr>
  <tr>
    <td>Deletion/return of Client/Candidate data post-termination</td>
    <td>30 days of termination</td>
    <td>Material breach; indemnity liability for data breach consequences.</td>
  </tr>
  <tr>
    <td>Update of KYC/registration information upon material change</td>
    <td>5 business days of change</td>
    <td>Material breach; potential suspension of Platform access.</td>
  </tr>
</table>

<!-- ==================== SCHEDULE C ==================== -->
<div class="schedule-title">SCHEDULE C &mdash;&mdash;&mdash; DATA PROCESSING AND PRIVACY TERMS</div>
<p style="font-style:italic; margin-bottom:8px; text-align:center;">This Schedule sets out the data processing obligations of the Parties and forms an integral part of the Agreement.</p>

<p class="sub-title">D1. Categories of Personal Data Processed</p>
<ul class="bullet-list">
  <li><strong>Candidate Data:</strong> Full name, contact details, residential address, date of birth, educational qualifications, employment history, current and expected CTC, resume, identity documents, and consent records.</li>
  <li><strong>Client Data (limited):</strong> Name and contact details of Client representatives received in the course of Platform communications (but Vendor shall not communicate with Clients as per Clause 3.11).</li>
  <li><strong>Vendor Data:</strong> Business registration details, KYC documents, bank account details, authorised signatory information, and GST records.</li>
</ul>

<p class="sub-title">D2. Purpose Limitation</p>
<p class="clause">All personal data processed by the Vendor under this Agreement shall be used solely for the purpose of sourcing, verifying, and submitting Candidates for specific Job Postings through the Platform. The Vendor shall not use Candidate or Client data for any other purpose, including marketing, list-building, or sharing with third parties outside the Platform.</p>

<p class="sub-title">D3. Security Standards</p>
<p class="clause">The Vendor shall implement and maintain, at minimum, the following:</p>
<ul class="bullet-list">
  <li>Encryption of data at rest and in transit using industry-standard protocols (AES-256 or equivalent).</li>
  <li>Role-based access controls restricting personal data access to authorised personnel only.</li>
  <li>Regular security assessments and vulnerability testing at least annually.</li>
  <li>Secure deletion or anonymisation of personal data upon expiry of retention periods.</li>
  <li>Mandatory employee training on data protection obligations.</li>
</ul>

<p class="sub-title">D4. Sub-Processors</p>
<p class="clause">The Vendor shall not engage any sub-processor to process personal data obtained through the Platform without Syncro1&rsquo;s prior written consent. The Vendor shall ensure that any approved sub-processor is bound by data processing obligations equivalent to those in this Schedule.</p>

<p class="sub-title">D5. Data Subject Rights</p>
<p class="clause">If a data subject makes a request to exercise rights under Applicable Law (access, correction, deletion, restriction, or portability), the Vendor shall: (a) acknowledge the request within 48 hours; (b) notify Syncro1 promptly; and (c) comply within the timelines required by Applicable Law.</p>

<p class="sub-title">D6. Data Breach Notification</p>
<p class="clause">In the event of an actual or suspected data breach, the Vendor shall: (a) notify Syncro1 in writing within 72 hours of becoming aware; (b) provide details of the nature, scope, and likely consequences of the breach; (c) describe the measures taken or proposed to address the breach; and (d) cooperate with Syncro1 in notifying affected data subjects and regulatory authorities as required by Applicable Law.</p>

<p class="sub-title">D7. Retention and Deletion</p>
<p class="clause">Personal data shall be retained only as long as necessary for the purposes for which it was collected, or as required by Applicable Law, and in no event for longer than three (3) years following the end of the relevant recruitment engagement. Upon termination, the Vendor shall securely delete or return all personal data within 30 days and provide written certification thereof.</p>

<!-- ==================== SCHEDULE E ==================== -->
<div class="schedule-title">SCHEDULE E &mdash;&mdash;&mdash; KYC AND DOCUMENT REQUIREMENTS</div>
<p style="margin-bottom:8px;">The following documents must be submitted by the Vendor during registration and maintained current throughout the Term. Failure to maintain up-to-date KYC documents is a material breach.</p>

<table>
  <tr>
    <th style="width:35%;">Document</th>
    <th style="width:30%;">Purpose</th>
    <th style="width:35%;">Format / Requirements</th>
  </tr>
  <tr>
    <td>Certificate of Incorporation / Company Registration Certificate</td>
    <td>Verification of legal entity status and registered name</td>
    <td>PDF/Image; government-issued and unaltered</td>
  </tr>
  <tr>
    <td>GST Registration Certificate</td>
    <td>Tax compliance and invoice eligibility</td>
    <td>PDF/Image; current and valid; GSTIN must match invoices</td>
  </tr>
  <tr>
    <td>Cancelled Cheque or Bank Statement (not older than 3 months)</td>
    <td>Bank account verification for payouts</td>
    <td>PDF/Image; account holder name must match Vendor legal name</td>
  </tr>
  <tr>
    <td>PAN Card of the Entity</td>
    <td>Tax identification for TDS purposes</td>
    <td>PDF/Image</td>
  </tr>
  <tr>
    <td>List of Authorised Signatories with specimen signatures and board resolution or authorisation letter</td>
    <td>Confirmation of persons authorised to bind the Vendor</td>
    <td>PDF; signed by a director or equivalent officer</td>
  </tr>
  <tr>
    <td>Data Protection Compliance Declaration</td>
    <td>Confirmation of Applicable Law compliance</td>
    <td>Signed declaration on Vendor letterhead</td>
  </tr>
  <tr>
    <td>Any other document requested by Sub Admin or Super Admin for KYC purposes</td>
    <td>As required by Syncro1 for regulatory compliance</td>
    <td>As specified at time of request</td>
  </tr>
</table>

<p style="margin-top:8px; font-size:9.5pt; font-style:italic;">All documents must be legible, unaltered, and in English (or accompanied by a certified English translation). Syncro1 reserves the right to request updated or additional documents at any time during the Term.</p>

<!-- ==================== SCHEDULE F ==================== -->
<div class="schedule-title">SCHEDULE F &mdash;&mdash;&mdash; AMENDMENT AND VARIATION LOG</div>
<p style="font-style:italic; margin-bottom:8px; text-align:center;">This Schedule records all formally agreed amendments executed by duly authorised representatives of both Parties in accordance with Clause 17.2.</p>

<table>
  <tr>
    <th style="width:8%;">No.</th>
    <th style="width:22%;">Date of Amendment</th>
    <th style="width:25%;">Clause(s) Amended</th>
    <th style="width:25%;">Nature of Amendment</th>
    <th style="width:20%;">Authorised Signatories</th>
  </tr>
  <tr><td>1</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>2</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  <tr><td>3</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>

<!-- ==================== VENDOR DETAILS RECORD ==================== -->
<div class="schedule-title" style="margin-top:20px;">VENDOR DETAILS RECORD</div>
<p style="font-style:italic; text-align:center; margin-bottom:8px;">This record is auto-generated from the Vendor&rsquo;s registered profile on the Platform.</p>

<div class="vendor-box">
  <h4>Vendor Information</h4>
  <div class="vendor-row"><span class="label">Legal Entity Name</span><span><strong>${vendorLegalName}</strong></span></div>
  <div class="vendor-row"><span class="label">Entity Type</span><span>${vendorType}</span></div>
  <div class="vendor-row"><span class="label">Registered Address</span><span>${vendorAddress}</span></div>
  <div class="vendor-row"><span class="label">PAN Number</span><span>${panNumber || 'N/A'}</span></div>
  <div class="vendor-row"><span class="label">GST Number</span><span>${gstNumber || 'N/A'}</span></div>
  <div class="vendor-row"><span class="label">CIN Number</span><span>${cinNumber || 'N/A'}</span></div>
  <div class="vendor-row"><span class="label">Authorised Signatory</span><span><strong>${signatoryName}</strong></span></div>
  <div class="vendor-row"><span class="label">Designation</span><span>${designation || 'N/A'}</span></div>
  <div class="vendor-row"><span class="label">Agreement Accepted On</span><span>${signedDateTime}</span></div>
  <div class="vendor-row"><span class="label">IP Address at Signing</span><span>${signedIp || 'N/A'}</span></div>
</div>

<!-- ==================== FOOTER ==================== -->
<div class="doc-footer">
  <p>This document was generated electronically by the Syncro1 Platform &nbsp;&bull;&nbsp; Document Reference: MSA-${Date.now()} &nbsp;&bull;&nbsp; Generated: ${new Date().toLocaleString('en-IN')}</p>
  <p style="margin-top:3px;">&copy; ${new Date().getFullYear()} Syncro1 Technologies Private Limited. All rights reserved.</p>
</div>

</div>
</body>
</html>`;
    }

    _mapEntityType(type) {
        const map = {
            'Proprietor': 'Sole Proprietorship registered under applicable law',
            'Partnership': 'Partnership firm registered under the Indian Partnership Act, 1932',
            'LLP': 'Limited Liability Partnership registered under the LLP Act, 2008',
            'Private Limited': 'Private Limited Company incorporated under the Companies Act, 2013',
            'Agency': 'Recruitment Agency registered under applicable law'
        };
        return map[type] || type || 'entity registered under applicable law';
    }

    _formatAddress(address) {
        if (!address) return '[REGISTERED ADDRESS]';
        if (typeof address === 'string') return address;
        return [
            address.street,
            address.city,
            address.state,
            address.pincode,
            address.country
        ].filter(Boolean).join(', ') || '[REGISTERED ADDRESS]';
    }
}

module.exports = new AgreementTemplateService();