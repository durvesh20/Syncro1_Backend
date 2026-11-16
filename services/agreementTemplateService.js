// backend/services/agreementTemplateService.js
const fs = require('fs');
const path = require('path');

class AgreementTemplateService {

  _getAbhiSignature() {
    try {
      const sigPath = path.join(__dirname, '../assets/Abhi-signature.jpeg');
      if (fs.existsSync(sigPath)) {
        const buf = fs.readFileSync(sigPath);
        return `data:image/jpeg;base64,${buf.toString('base64')}`;
      }
    } catch (e) {
      console.error('[AGREEMENT] Error reading Abhi signature from assets:', e);
    }
    return '';
  }

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
      agreedAt,
      agreedIp,
      city,
      state,
      documents,
      authorizedSignatoryProof,
      digitalSignature,
      signatureUrl,
      signature
    } = partnerData;

    const abhiSignatureImg = this._getAbhiSignature();

    // Use authorizedSignatoryProof (the photo uploaded during onboarding) as the partner's signature image
    // Fall back to digitalSignature if no proof is uploaded
    const rawPartnerSig = authorizedSignatoryProof || digitalSignature || signatureUrl || signature;
    let partnerSigImg = '';
    if (rawPartnerSig && typeof rawPartnerSig === 'string') {
      const isImg = rawPartnerSig.startsWith('data:image/') ||
        /\.(jpe?g|png|webp|svg)(\?.*)?$/i.test(rawPartnerSig) ||
        rawPartnerSig.includes('/image/upload/') ||
        rawPartnerSig.includes('cloudinary');
      if (isImg && !rawPartnerSig.toLowerCase().endsWith('.pdf')) {
        partnerSigImg = rawPartnerSig;
      }
    }

    let partnerPlace = '';
    if (city && state) {
      partnerPlace = `${city}, ${state}`;
    } else if (city) {
      partnerPlace = city;
    } else if (typeof registeredAddress === 'object' && registeredAddress?.city) {
      partnerPlace = `${registeredAddress.city}${registeredAddress.state ? `, ${registeredAddress.state}` : ''}`;
    } else if (typeof registeredAddress === 'string' && registeredAddress.trim()) {
      partnerPlace = registeredAddress.trim();
    } else if (state) {
      partnerPlace = state;
    } else {
      partnerPlace = 'India';
    }

    const formattedDate = new Date(agreementDate || Date.now()).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const agreedDateTime = new Date(agreedAt || Date.now()).toLocaleString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const partnerLegalName = registeredName || firmName || '[Full Legal Name of Talent Partner]';
    const partnerType = this._mapEntityType(entityType);
    const partnerAddress = this._formatAddress(registeredAddress);
    const signatoryName = `${firstName || ''} ${lastName || ''}`.trim() || '[Authorised Signatory]';
    const partnerDesignation = designation || 'Authorised Signatory';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Master Talent Partner Agreement - Syncro1 x ${partnerLegalName}</title>
<style>
  @page {
    size: A4;
    margin: 20mm 20mm 20mm 20mm;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html {
    width: 210mm;
  }

  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 10pt;
    line-height: 1.5;
    color: #111;
    background: #fff;
    padding: 0;
    margin: 0;
  }

  .wrap {
    padding: 0 2mm;
  }

  /* ---- HEADER ---- */
  .doc-header {
    text-align: center;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 2px solid #000;
  }
  .doc-header .t1 {
    font-size: 13pt;
    font-weight: bold;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin-bottom: 2px;
  }
  .doc-header .t2 {
    font-size: 11pt;
    font-weight: bold;
    letter-spacing: 0.3px;
    margin-bottom: 3px;
  }
  .doc-header .t3 {
    font-size: 8.5pt;
    font-style: italic;
    color: #444;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  /* ---- DRAFTING CALLOUT BOX ---- */
  .callout-box {
    border: 1px solid #777;
    background: #fafafa;
    padding: 8px 12px;
    margin: 10px 0 14px 0;
    font-size: 8.5pt;
    line-height: 1.4;
  }
  .callout-title {
    font-weight: bold;
    text-transform: uppercase;
    font-size: 8.5pt;
    margin-bottom: 3px;
    color: #b91c1c;
  }

  /* ---- SECTION TITLES ---- */
  .art {
    font-size: 10pt;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 14px;
    margin-bottom: 5px;
    border-bottom: 1px solid #000;
    padding-bottom: 2px;
    page-break-after: avoid;
  }

  .sart {
    font-size: 9.5pt;
    font-weight: bold;
    margin-top: 8px;
    margin-bottom: 3px;
    page-break-after: avoid;
  }

  /* ---- TEXT ---- */
  p {
    margin-bottom: 5px;
    text-align: justify;
    orphans: 3;
    widows: 3;
  }

  .cl {
    margin-bottom: 5px;
    text-align: justify;
    orphans: 3;
    widows: 3;
  }

  .bd { font-weight: bold; }
  .it { font-style: italic; }

  /* ---- BULLETS & LISTS ---- */
  ul.bul {
    margin: 4px 0 6px 20px;
    padding: 0;
  }
  ul.bul li {
    margin-bottom: 3px;
    text-align: justify;
    list-style: disc;
  }

  ol.num {
    margin: 4px 0 6px 20px;
    padding: 0;
  }
  ol.num li {
    margin-bottom: 4px;
    text-align: justify;
  }

  /* ---- TABLES ---- */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 9pt;
  }
  table th {
    background: #e5e5e5;
    border: 1px solid #333;
    padding: 5px 8px;
    font-weight: bold;
    text-align: left;
  }
  table td {
    border: 1px solid #333;
    padding: 5px 8px;
    vertical-align: top;
  }
  tr { page-break-inside: avoid; }

  /* ---- SIGNATURES ---- */
  .sig-wrap {
    margin-top: 14px;
    page-break-inside: avoid;
  }
  .sig-grid {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid #000;
    margin-top: 6px;
  }
  .sig-grid td {
    width: 50%;
    padding: 10px 14px;
    vertical-align: top;
    border: none;
  }
  .sig-grid td:first-child {
    border-right: 1px solid #000;
  }
  .sig-lbl {
    font-size: 8pt;
    font-weight: bold;
    text-transform: uppercase;
    color: #555;
    margin-bottom: 2px;
  }
  .sig-name {
    font-size: 9.5pt;
    font-weight: bold;
    text-transform: uppercase;
    margin-bottom: 10px;
    line-height: 1.3;
  }
  .sig-blank {
    border: 1px dashed #94a3b8;
    padding: 8px 10px;
    margin-top: 8px;
    background: #f8fafc;
    border-radius: 4px;
    text-align: center;
    color: #64748b;
    font-size: 8pt;
    font-style: italic;
  }
  .sig-accepted {
    border: 1px solid #bfdbfe;
    border-left: 3px solid #1e40af;
    padding: 6px 10px;
    margin-top: 8px;
    background: #f8faff;
    border-radius: 4px;
  }
  .sig-accepted .sa-text {
    font-size: 8pt;
    font-weight: bold;
    color: #1e40af;
    margin-bottom: 3px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .sig-accepted .sa-meta {
    font-size: 7.5pt;
    color: #475569;
    border-top: 1px solid #e2e8f0;
    padding-top: 3px;
    margin-top: 2px;
    line-height: 1.4;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .sf {
    font-size: 9pt;
    margin-bottom: 3px;
    line-height: 1.4;
  }

  /* ---- AUDIT RECORD ---- */
  .vr {
    border: 1px solid #444;
    margin: 10px 0;
  }
  .vr-title {
    background: #e2e8f0;
    padding: 4px 8px;
    font-weight: bold;
    font-size: 8.5pt;
    text-transform: uppercase;
    border-bottom: 1px solid #444;
  }
  .vr-row {
    display: flex;
    border-bottom: 0.5px solid #cbd5e1;
    font-size: 8.5pt;
  }
  .vr-row:last-child { border-bottom: none; }
  .vr-lbl {
    width: 160px;
    min-width: 160px;
    padding: 3px 8px;
    font-weight: bold;
    background: #f8fafc;
    border-right: 0.5px solid #cbd5e1;
  }
  .vr-val {
    padding: 3px 8px;
    flex: 1;
  }

  /* ---- FOOTER ---- */
  .doc-footer {
    margin-top: 14px;
    padding-top: 6px;
    border-top: 0.5px solid #aaa;
    font-size: 7.5pt;
    color: #666;
    text-align: center;
  }

</style>
</head>
<body>
<div class="wrap">

<!-- HEADER -->
<div class="doc-header">
  <div class="t1">MASTER TALENT PARTNER AGREEMENT</div>
  <div class="t2">SYNCRO1 PVT LTD</div>
  <div class="t3">Balanced commercial terms &bull; Clear candidate attribution &bull; Targeted platform protections</div>
</div>

<!-- DRAFTING STATUS -->
<div class="art">DRAFTING STATUS &mdash; PLEASE READ</div>
<p class="cl">This is a comprehensive working draft for review by qualified Indian counsel. It is not a legal opinion, stamp-duty determination, or certification of enforceability. Complete all bracketed fields, confirm the commercial schedule, check current law and Maharashtra stamp duty, and obtain legal approval before signature.</p>
<p class="cl"><strong>Drafting assumption:</strong> Syncro1 is the platform/business operated by the contracting entity identified below. The legal entity name, registered office, PAN/GSTIN and signatory authority must be inserted accurately. &ldquo;Talent Partner&rdquo; is used consistently as the commercial term; it does not itself determine the legal status of the party.</p>

<!-- PARTIES AND EFFECTIVE DATE -->
<div class="art">PARTIES AND EFFECTIVE DATE</div>
<p class="cl">This Master Talent Partner Agreement (&ldquo;Agreement&rdquo;) is made on <strong>${formattedDate}</strong> (&ldquo;Effective Date&rdquo;) by and between:</p>

<p class="cl"><strong>(A) Syncro1 Private Limited</strong>, a Private Limited Company, incorporated/registered under the laws of India, having its registered office at H801 Tiana Bldg Bellacasa, Sr No.42(P),43(P) 44(P), Sus, Haveli, Pune- 411021, Maharashtra [address], CIN: U78100PN2026PTC251070 , PAN ABSCS5163N and GSTIN 27ABSCS5163N1ZF (&ldquo;Syncro1&rdquo;); and</p>

<p class="cl"><strong>(B) ${partnerLegalName}</strong>, a ${partnerType} organised or residing under the laws of India, having its principal address at <strong>${partnerAddress}</strong>, PAN <strong>${panNumber || '[●]'}</strong>, GSTIN (if applicable) <strong>${gstNumber || '[●]'}</strong>, registration number (if applicable) <strong>${cinNumber || '[●]'}</strong> (&ldquo;Talent Partner&rdquo;).</p>

<p class="cl">Syncro1 and the Talent Partner are each a &ldquo;Party&rdquo; and together the &ldquo;Parties&rdquo;.</p>

<!-- 1. DEFINITIONS AND INTERPRETATION -->
<div class="art">1. DEFINITIONS AND INTERPRETATION</div>
<div class="sart">1. Definitions</div>
<p class="cl"><strong>1.1 &ldquo;Candidate&rdquo;</strong> means an individual whose profile or information is submitted or processed for a role through the Platform or in accordance with this Agreement.</p>
<p class="cl"><strong>1.2 &ldquo;Client&rdquo;</strong> means an organization for which Syncro1 has authorized a hiring mandate, role or opportunity to be worked on by the Talent Partner.</p>
<p class="cl"><strong>1.3 &ldquo;Platform&rdquo;</strong> means Syncro1&rsquo;s online platform, tools, workflows and related systems made available to the Talent Partner.</p>
<p class="cl"><strong>1.4 &ldquo;Protected Opportunity&rdquo;</strong> means a specific Client and role/requisition that Syncro1 has identified to the Talent Partner in writing or through an auditable Platform record, and for which the Talent Partner has accepted or actively worked the mandate through Syncro1.</p>
<p class="cl"><strong>1.5 &ldquo;Placement&rdquo;</strong> means a Candidate introduced by the Talent Partner who is hired or engaged by a Client in connection with a Protected Opportunity, as evidenced by a written offer, joining confirmation or other reliable record.</p>
<p class="cl"><strong>1.6 &ldquo;Fixed Annual CTC&rdquo;</strong> means the annual fixed compensation stated in the Candidate&rsquo;s final offer letter, excluding variable pay, bonus, equity, benefits and employer contributions unless Schedule A expressly states otherwise.</p>
<p class="cl"><strong>1.7 &ldquo;Business Day&rdquo;</strong> means a day other than Saturday, Sunday or a public/bank holiday in Pune, Maharashtra.</p>
<p class="cl"><strong>1.8</strong> Headings are for convenience only. &ldquo;Including&rdquo; means &ldquo;including without limitation.&rdquo; In case of conflict, the main body governs unless a Schedule expressly states that it overrides a specified clause.</p>

<!-- 2. APPOINTMENT AND RELATIONSHIP -->
<div class="art">2. APPOINTMENT AND RELATIONSHIP</div>
<div class="sart">2. Appointment</div>
<p class="cl"><strong>2.1</strong> Syncro1 appoints the Talent Partner on a non-exclusive basis to identify and submit suitable Candidates for Protected Opportunities made available to it. The Talent Partner may accept or decline any opportunity.</p>
<p class="cl"><strong>2.2</strong> This Agreement does not guarantee any minimum number of roles, submissions, interviews, Placements, revenue or work to either Party. Syncro1 may work with other Talent Partners and the Talent Partner may work with other clients and platforms, subject to the specific Protected Opportunity protections in Clause 7.</p>
<p class="cl"><strong>2.3</strong> The Talent Partner acts as an independent business and not as an employee, agent, legal representative, joint venture partner or franchisee of Syncro1. Neither Party may bind the other, make commitments on the other&rsquo;s behalf, or represent that it has authority to do so.</p>
<p class="cl"><strong>2.4</strong> The Talent Partner is responsible for its own personnel, business expenses, tax filings, registrations, insurance and statutory obligations applicable to its business and personnel. Nothing in this clause excludes any mandatory legal obligation that cannot lawfully be contracted out of.</p>
<p class="cl"><strong>2.5</strong> The Talent Partner shall not charge a Candidate any fee for access to a role or for being submitted to a Client, unless such charge is expressly permitted by applicable law and approved in writing by Syncro1; Syncro1&rsquo;s default policy is that Candidates are not charged.</p>

<!-- 3. PLATFORM ACCESS AND OPERATIONAL CONTROLS -->
<div class="art">3. PLATFORM ACCESS AND OPERATIONAL CONTROLS</div>
<div class="sart">3. Platform use</div>
<p class="cl"><strong>3.1</strong> Syncro1 may provide Platform access, role information and workflow instructions. Access is limited, revocable and non-transferable. The Talent Partner shall keep credentials secure and promptly notify Syncro1 of suspected unauthorised access.</p>
<p class="cl"><strong>3.2</strong> The Talent Partner shall use the Platform only for legitimate recruitment activity under this Agreement, shall not scrape, reverse engineer, interfere with, test or misuse the Platform, and shall not upload malware or unlawfully obtained data.</p>
<p class="cl"><strong>3.3</strong> Syncro1 may reasonably update workflows, security controls and Platform features. Any material change to agreed commercial terms must be made in writing and shall not retrospectively reduce commission already earned.</p>
<p class="cl"><strong>3.4</strong> Syncro1 may suspend or restrict the Talent Partner&rsquo;s access to the Platform where reasonably necessary due to suspected fraud, misconduct, breach of this Agreement, security concerns, inaccurate submissions or other legitimate compliance or operational reasons. Such suspension shall not, by itself, constitute a cancellation of any payment obligation that has become due and payable under this Agreement. However, Syncro1 shall be entitled to verify any commission claim, dispute any amount reasonably believed to be incorrect, unsupported, fraudulent or otherwise not payable under this Agreement, and withhold the disputed amount pending investigation and resolution. Syncro1 may also exercise any right of set-off, recovery or adjustment available under this Agreement or applicable law. Any undisputed amount that is properly due shall be processed in accordance with the payment terms of this Agreement. Nothing in this clause shall require Syncro1 to pay any commission that has not been earned or that is otherwise not payable under this Agreement.</p>

<!-- 4. TALENT PARTNER OBLIGATIONS -->
<div class="art">4. TALENT PARTNER OBLIGATIONS</div>
<div class="sart">4. Professional conduct and submissions</div>
<p class="cl"><strong>4.1</strong> The Talent Partner shall use skill, care and diligence; submit Candidates who match the stated role requirements; and communicate accurately, respectfully and without discrimination.</p>
<p class="cl"><strong>4.2</strong> Before submitting a Candidate, the Talent Partner shall obtain the Candidate&rsquo;s informed authorisation to share their profile and relevant personal data with Syncro1 and the identified Client for the stated recruitment purpose. The Talent Partner shall retain a record of authorisation and provide it on reasonable request.</p>
<p class="cl"><strong>4.3</strong> The Talent Partner shall not fabricate, materially alter or knowingly misrepresent a CV, qualification, employment history, compensation, notice period, identity, consent or reference. Any verification shall be proportionate, lawful and consistent with Candidate notice and consent where required.</p>
<p class="cl"><strong>4.4</strong> The Talent Partner shall promptly correct material inaccuracies, disclose any known conflict of interest and notify Syncro1 of a Candidate withdrawal, change in availability or other material development.</p>
<p class="cl"><strong>4.5</strong> The Talent Partner shall not promise an offer, compensation, joining date, visa, relocation, client decision or outcome unless expressly authorised in writing by the relevant Client or Syncro1.</p>
<p class="cl"><strong>4.6</strong> The Talent Partner shall comply with applicable anti-bribery, anti-discrimination, employment, tax, privacy and information-security laws and shall not offer or accept an improper payment, kickback or benefit in connection with a Protected Opportunity.</p>
<p class="cl"><strong>4.7</strong> The Talent Partner shall not submit the same Candidate to a Client for the same role through multiple channels without disclosing the prior submission and obtaining Syncro1&rsquo;s written direction.</p>

<!-- 5. CANDIDATE ATTRIBUTION AND PLACEMENT CONFIRMATION -->
<div class="art">5. CANDIDATE ATTRIBUTION AND PLACEMENT CONFIRMATION</div>
<div class="sart">5. Attribution</div>
<p class="cl"><strong>5.1</strong> Candidate attribution will ordinarily be determined by reliable, time-stamped Platform records showing the first complete and authorised submission for the relevant role. A submission is complete when it identifies the Candidate, role and required profile information and records the Candidate&rsquo;s authorisation.</p>
<p class="cl"><strong>5.2</strong> A Client&rsquo;s documented prior receipt of the Candidate&rsquo;s profile or an active process for the same role before the Talent Partner&rsquo;s submission may defeat attribution for that role. A mere database entry or undocumented assertion will not, by itself, conclusively defeat attribution.</p>
<p class="cl"><strong>5.3</strong> If a duplicate or attribution dispute arises, Syncro1 shall notify the Talent Partner of the issue and consider relevant evidence from both Parties. The Parties shall attempt in good faith to resolve the dispute within ten (10) Business Days. Syncro1&rsquo;s Platform records are evidence, but are not conclusive where credible contrary evidence exists.</p>
<p class="cl"><strong>5.4</strong> Where a Candidate is hired by the Client for a different role or through a materially different process, the Parties shall assess attribution based on the evidence, the applicable Client terms and whether the hire arose from the Talent Partner&rsquo;s introduction. Any commission determination must be reasonable and documented.</p>
<p class="cl"><strong>5.5</strong> The Talent Partner shall reasonably assist in confirming interview, offer and joining status. Syncro1 shall use reasonable efforts to confirm a Placement with the Client and shall not unreasonably withhold confirmation where reliable evidence of joining is available.</p>

<!-- 6. COMMERCIAL TERMS, INVOICING AND PAYMENT -->
<div class="art">6. COMMERCIAL TERMS, INVOICING AND PAYMENT</div>
<div class="sart">6. Fees and payment</div>
<p class="cl"><strong>6.1</strong> The commission rate and any role-specific variation are set out in Schedule A. A variation is valid only if agreed in writing by authorised representatives of both Parties before the relevant Candidate is submitted or, if later, before the Candidate is shortlisted.</p>
<p class="cl"><strong>6.2</strong> Unless Schedule A expressly provides otherwise, commission is calculated on the Fixed Annual CTC in the Candidate&rsquo;s final offer letter. Any change in compensation after the offer shall be reflected only where the Parties agree in writing or the final offer clearly supersedes the earlier offer.</p>
<p class="cl"><strong>6.3</strong> Commission shall become eligible for payment upon the Candidate successfully completing ninety (90) calendar days of employment with the Client from the Candidate&rsquo;s joining date, subject to the replacement policy set out in this Agreement. Syncro1 shall process payment of the undisputed commission within fifteen (15) calendar days after the later of (i) the Candidate&rsquo;s completion of the said ninety (90)-day period and (ii) receipt of a compliant invoice and the reasonable supporting documents specified in Schedule A. If the Candidate resigns or is terminated within the initial ninety (90)-day period, the commission shall not become payable, subject to the terms and exclusions of the replacement policy in this Agreement.</p>
<p class="cl"><strong>6.4</strong> The Talent Partner shall issue a valid tax invoice where required by law and provide accurate bank, PAN and GST details, if applicable. GST shall be paid only against a valid invoice and in accordance with applicable law. Syncro1 may deduct or withhold tax where legally required and shall provide the relevant certificate or details within the statutory timeframe.</p>
<p class="cl"><strong>6.5</strong> If Syncro1 disputes an invoice in good faith, it shall notify the Talent Partner within fifteen (15) calendar days of receipt, identifying the disputed item and reasons. Syncro1 shall pay the undisputed portion within the agreed payment period. The Parties shall work promptly to resolve the disputed portion.</p>
<p class="cl"><strong>6.6</strong> Neither Party may make a unilateral retrospective reduction or cancellation of an earned commission. Set-off is permitted only for amounts admitted in writing by the other Party, finally determined by a court/arbitral tribunal, or otherwise expressly agreed in writing, except for deductions required by law.</p>
<p class="cl"><strong>6.7</strong> No fee is payable for a Candidate who does not join, unless the Parties expressly agree otherwise in writing. No payment is contingent upon the Talent Partner guaranteeing a hiring outcome or the Client&rsquo;s continued employment of the Candidate.</p>
<p class="cl"><strong>6.8</strong> Each Party shall maintain accurate records relating to submissions, offers, joining, invoices and payments for at least eight (8) years or such other period as applicable law requires.</p>

<!-- 7. TARGETED NON-CIRCUMVENTION AND PROTECTED OPPORTUNITIES -->
<div class="art">7. TARGETED NON-CIRCUMVENTION AND PROTECTED OPPORTUNITIES</div>
<div class="sart">7. Limited opportunity protection</div>
<p class="cl"><strong>7.1</strong> For each Protected Opportunity, the Talent Partner shall not knowingly use confidential information supplied by Syncro1 to deliberately bypass Syncro1 for the primary purpose of avoiding commission that would otherwise be payable under this Agreement.</p>
<p class="cl"><strong>7.2</strong> This restriction applies to each specific Client and hiring requirement introduced or made available to the Talent Partner through Syncro1 and documented in the Platform or in writing (&ldquo;Protected Opportunity&rdquo;). During the period in which the Protected Opportunity remains active and for twelve (12) months thereafter, the Talent Partner shall not knowingly bypass Syncro1 by directly or indirectly pursuing or completing the same Protected Opportunity for the purpose of avoiding commission or other fees contractually payable to Syncro1. This restriction shall not prevent the Talent Partner from working with the Client on unrelated hiring requirements or from continuing a demonstrable pre-existing business relationship, provided that such activities do not involve the deliberate circumvention of Syncro1 in relation to the Protected Opportunity. The restriction shall apply only to the extent permitted by applicable law and shall not operate as a general restriction on the Talent Partner&rsquo;s lawful business activities.</p>
<p class="cl"><strong>7.3</strong> The restriction does not apply to a Client relationship or opportunity that the Talent Partner can demonstrate through contemporaneous written records existed independently before Syncro1&rsquo;s introduction; an unsolicited approach unrelated to the Protected Opportunity; public information independently obtained; or work authorised in writing by Syncro1.</p>
<p class="cl"><strong>7.4</strong> Nothing in this clause prohibits lawful competition, generally approaching clients, working with other platforms or accepting unrelated work. The Parties intend this clause to protect documented confidential information and agreed fees, not to restrain lawful trade. It shall be interpreted and enforced only to the extent permitted by applicable law.</p>
<p class="cl"><strong>7.5</strong> If a breach is established, the non-breaching Party may seek unpaid contractual fees and compensation for proven, legally recoverable loss in accordance with applicable law. No automatic penalty or double recovery applies. Any injunctive or other equitable relief is subject to the applicable court or tribunal&rsquo;s discretion.</p>

<!-- 8. REPLACEMENT SUPPORT -->
<div class="art">8. REPLACEMENT SUPPORT</div>
<div class="sart">8. 90-day replacement support</div>
<p class="cl"><strong>8.1</strong> If a Candidate placed under this Agreement voluntarily resigns or is terminated for documented performance or misconduct reasons within ninety (90) calendar days of joining, the Talent Partner shall make reasonable efforts to provide one replacement Candidate for the same role without an additional placement commission, subject to the exclusions below.</p>
<p class="cl"><strong>8.2</strong> Replacement support applies only if Syncro1 notifies the Talent Partner within twenty (20) Business Days after learning of the departure and provides reasonable details, subject to confidentiality and applicable law.</p>
<p class="cl"><strong>8.3</strong> Replacement support does not apply where the departure results materially from redundancy, restructuring, role elimination, material change in role or compensation, workplace misconduct, non-payment or material breach by the Client, or another circumstance outside the Talent Partner&rsquo;s reasonable control.</p>
<p class="cl"><strong>8.4</strong> Replacement support is the sole contractual remedy for an eligible early departure, unless Schedule A expressly provides otherwise. It does not automatically require repayment or forfeiture of commission already earned and paid. The Parties may agree a different written remedy for a specific role before submission.</p>

<!-- 9. CONFIDENTIALITY -->
<div class="art">9. CONFIDENTIALITY</div>
<div class="sart">9. Confidential information</div>
<p class="cl"><strong>9.1 &ldquo;Confidential Information&rdquo;</strong> means non-public business, commercial, technical, candidate, client, pricing, platform, security and operational information disclosed by or on behalf of a Party, whether orally, visually, electronically or in writing, that is marked confidential or should reasonably be understood to be confidential.</p>
<p class="cl"><strong>9.2</strong> The receiving Party shall use Confidential Information only to perform this Agreement, protect it using at least reasonable care, disclose it only to personnel who need to know and are bound by confidentiality obligations, and remain responsible for their compliance.</p>
<p class="cl"><strong>9.3</strong> Confidential Information excludes information the receiving Party can demonstrate was lawfully known without restriction, becomes public without breach, is independently developed without use of the information, or is lawfully received from a third party without confidentiality duty.</p>
<p class="cl"><strong>9.4</strong> If disclosure is required by law or a competent authority, the receiving Party may disclose only the required portion and, where lawful and practicable, shall give advance notice to the disclosing Party.</p>
<p class="cl"><strong>9.5</strong> On termination or reasonable written request, the receiving Party shall return or securely delete Confidential Information, except copies retained for legal, regulatory, audit or bona fide archival purposes, which remain protected under this clause.</p>
<p class="cl"><strong>9.6</strong> These obligations continue for five (5) years after termination; trade secrets and personal data remain protected for as long as they qualify for protection under applicable law.</p>

<!-- 10. PERSONAL DATA AND INFORMATION SECURITY -->
<div class="art">10. PERSONAL DATA AND INFORMATION SECURITY</div>
<div class="sart">10. Data handling</div>
<p class="cl"><strong>10.1</strong> Each Party shall comply with privacy, data-protection and information-security laws applicable to its activities and the relevant processing at the time. The Parties acknowledge that the commencement of the Digital Personal Data Protection Act, 2023 and its Rules is staged; this clause does not imply that every provision is already in force.</p>
<p class="cl"><strong>10.2 Candidate Data and Authorisation:</strong> The Talent Partner shall be solely responsible for ensuring that it has obtained all necessary candidate consents, authorisations, notices and permissions required under applicable law before collecting, accessing or sharing Candidate personal data with Syncro1 or any Client. The Talent Partner shall ensure that such data is lawfully obtained, accurate to the best of its knowledge, relevant to the applicable hiring requirement and limited to what is reasonably necessary for the recruitment purpose. The Talent Partner shall retain appropriate evidence of such consent or authorisation and provide it to Syncro1 upon request. Syncro1 shall be entitled to rely on the Talent Partner&rsquo;s representations and confirmations in this regard, without prejudice to its own obligations under applicable law.</p>
<p class="cl"><strong>10.3 Data Security and Incident Notification:</strong> The Talent Partner shall implement and maintain appropriate technical, organisational and administrative safeguards to protect Candidate personal data against unauthorised access, disclosure, alteration, loss, misuse or destruction. The Talent Partner shall restrict access to such data to authorised personnel who require it for the relevant recruitment purpose and shall use secure methods when transmitting or storing such data. The Talent Partner shall notify Syncro1 in writing without undue delay, and in any event within twenty-four (24) hours of becoming aware of any actual or reasonably suspected unauthorised access, disclosure, loss, misuse or security incident involving Candidate personal data shared with, or processed in connection with, Syncro1. The notification shall include all information reasonably available regarding the nature of the incident, affected data, potential impact and remedial measures taken or proposed. The Talent Partner shall promptly cooperate with Syncro1 in investigating, containing, mitigating and resolving the incident and shall bear responsibility for the consequences to the extent caused by its breach of this Agreement or applicable law.</p>
<p class="cl"><strong>10.4</strong> The notice under Clause 10.3 shall be given without undue delay and, where practicable, within forty-eight (48) hours after awareness. It shall include known facts, likely impact, mitigation steps and a contact for follow-up. This contractual notice does not replace any statutory reporting obligation.</p>
<p class="cl"><strong>10.5 Restrictions on Candidate Data Use by Talent Partner:</strong> The Talent Partner shall not sell, disclose, transfer, use for unrelated marketing, use to enrich databases unrelated to the agreed recruitment purpose, or otherwise exploit Candidate personal data obtained through or in connection with Syncro1 for any purpose unrelated to the relevant hiring requirement, without the prior written approval of Syncro1 and any consent or authorisation required under applicable law. The Talent Partner shall not retain such data beyond the period reasonably necessary for the authorised recruitment purpose, except where retention is required by applicable law. Nothing in this clause shall restrict Syncro1 from collecting, processing, using, sharing or retaining Candidate personal data for legitimate platform operations, recruitment services, client requirements, fraud prevention, dispute resolution, legal or regulatory compliance, or recordkeeping, in each case subject to applicable law and any required notices, consents or other lawful basis.</p>
<p class="cl"><strong>10.6</strong> The Parties shall reasonably cooperate with requests concerning Candidate data, corrections, withdrawal of authorisation, deletion, security incidents and regulatory enquiries, subject to law and the Parties&rsquo; respective roles.</p>
<p class="cl"><strong>10.7</strong> Where the actual processing model requires a separate data-processing agreement, transfer terms, or specific controller/processor allocation, the Parties shall execute the additional terms in Schedule C or a separate written addendum before that processing begins.</p>

<!-- 11. INTELLECTUAL PROPERTY AND PUBLICITY -->
<div class="art">11. INTELLECTUAL PROPERTY AND PUBLICITY</div>
<div class="sart">11. Ownership and permitted use</div>
<p class="cl"><strong>11.1</strong> Each Party retains ownership of its pre-existing intellectual property, tools, processes, templates, marks and materials. No ownership transfers under this Agreement.</p>
<p class="cl"><strong>11.2</strong> Syncro1 grants the Talent Partner a limited, non-exclusive, non-transferable, revocable right during the term to use the Platform and Syncro1 materials solely to perform this Agreement.</p>
<p class="cl"><strong>11.3</strong> The Talent Partner shall not use Syncro1&rsquo;s or a Client&rsquo;s name, logo, marks, testimonials or relationship in marketing, publicity or case studies without prior written consent.</p>
<p class="cl"><strong>11.4</strong> The Talent Partner shall not copy, reverse engineer, resell or commercially exploit the Platform or its non-public workflows except as expressly authorised in writing.</p>

<!-- 12. REPRESENTATIONS, WARRANTIES AND COMPLIANCE -->
<div class="art">12. REPRESENTATIONS, WARRANTIES AND COMPLIANCE</div>
<div class="sart">12. Mutual assurances</div>
<p class="cl"><strong>12.1</strong> Each Party represents that it has authority to enter into and perform this Agreement and that doing so does not knowingly breach another binding obligation.</p>
<p class="cl"><strong>12.2</strong> Each Party shall comply with laws applicable to its performance, including applicable tax, anti-bribery, privacy, data-security and non-discrimination requirements.</p>
<p class="cl"><strong>12.3</strong> The Talent Partner represents that it will not knowingly submit stolen, unlawfully obtained or materially falsified Candidate information and will not knowingly misrepresent its identity, legal status or authority.</p>
<p class="cl"><strong>12.4</strong> Except as expressly stated, neither Party guarantees a particular hiring outcome, Platform uptime, Client decision, Candidate performance or volume of business. Mandatory rights and liabilities that cannot lawfully be excluded remain unaffected.</p>

<!-- 13. INDEMNITY AND LIMITATION OF LIABILITY -->
<div class="art">13. INDEMNITY AND LIMITATION OF LIABILITY</div>
<div class="sart">13. Risk allocation</div>
<p class="cl"><strong>13.1</strong> Each Party (&ldquo;Indemnifying Party&rdquo;) shall indemnify the other Party against third-party claims, and reasonable direct losses, costs and expenses finally awarded or agreed in settlement, to the extent caused by the Indemnifying Party&rsquo;s (a) fraud or wilful misconduct; (b) material breach of confidentiality or data-security obligations; (c) infringement of third-party intellectual property rights by materials it supplied; or (d) violation of law in performing this Agreement. The indemnified Party shall give prompt notice, reasonable cooperation and control of the defence to the Indemnifying Party, provided no settlement may impose liability or an admission on the indemnified Party without its written consent.</p>
<p class="cl"><strong>13.2</strong> Subject to Clause 13.3, neither Party shall be liable to the other for indirect, incidental, special, exemplary or consequential loss, or loss of anticipated profit, revenue, goodwill or business opportunity, except to the extent such loss forms part of a third-party claim covered under Clause 13.1 or cannot lawfully be excluded.</p>
<p class="cl"><strong>13.3</strong> Subject to Clause 13.4, Syncro1&rsquo;s aggregate liability arising out of or in connection with this Agreement, whether in contract, tort or otherwise, shall not exceed the lower of (i) the total commission paid or payable to the Talent Partner during the twelve (12) months immediately preceding the event giving rise to the claim, or (ii) INR 5,00,000 (Indian Rupees Five Lakh). Where no commission has been paid or become payable during that period, Syncro1&rsquo;s aggregate liability shall not exceed INR 1,00,000 (Indian Rupees One Lakh). The Talent Partner&rsquo;s aggregate liability arising out of or in connection with this Agreement shall not exceed the greater of (i) the total commission paid or payable to the Talent Partner during the twelve (12) months immediately preceding the event giving rise to the claim, or (ii) INR 5,00,000 (Indian Rupees Five Lakh), except for the matters specified in Clause 13.4. Neither Party shall be liable to the other for any indirect, incidental, special, exemplary or consequential loss, or loss of anticipated profits, revenue, goodwill or business opportunity, except to the extent such loss forms part of a third-party claim covered under this Agreement or cannot lawfully be excluded. Nothing in this clause shall limit liability to the extent such limitation is prohibited by applicable law.</p>
<p class="cl"><strong>13.4 Exceptions to Limitation of Liability:</strong> The limitations and exclusions set out in Clauses 13.2 and 13.3 shall not apply to: (a) the Talent Partner&rsquo;s obligations to indemnify Syncro1 for losses, claims, damages, costs and expenses arising from the Talent Partner&rsquo;s breach of its obligations under this Agreement, to the extent recoverable under applicable law; (b) fraud, fraudulent misrepresentation, wilful misconduct or deliberate unlawful acts by either Party; (c) the Talent Partner&rsquo;s unauthorised use, disclosure, transfer, sale or misuse of Candidate personal data, Syncro1&rsquo;s Confidential Information or Client information, or any breach of the Talent Partner&rsquo;s confidentiality and data-protection obligations; (d) infringement, misappropriation or unauthorised use of Syncro1&rsquo;s or a third party&rsquo;s intellectual property by the Talent Partner; (e) any unpaid commission or other amount that has become due and payable under this Agreement, subject to the applicable payment terms and any bona fide dispute; or (f) any liability that cannot lawfully be excluded or limited under applicable law. For clarity, Syncro1&rsquo;s liability for ordinary contractual claims shall remain subject to the cap specified in Clause 13.3. The exceptions above shall not automatically render Syncro1&rsquo;s liability unlimited; any liability of Syncro1 falling within an exception shall remain subject to the limitations permitted by applicable law and any expressly applicable contractual limitation. No Party shall be entitled to recover twice for the same loss, and all claims shall remain subject to applicable legal requirements, including the duty to establish recoverable loss where required.</p>
<p class="cl"><strong>13.5</strong> A Party seeking recovery shall take reasonable steps to mitigate its loss. No Party may recover twice for the same loss. Any contractual remedy remains subject to Sections 73 and 74 of the Indian Contract Act, 1872 and other applicable law.</p>

<!-- 14. TERM, SUSPENSION AND TERMINATION -->
<div class="art">14. TERM, SUSPENSION AND TERMINATION</div>
<div class="sart">14. Duration and exit</div>
<p class="cl"><strong>14.1</strong> This Agreement begins on the Effective Date and continues until terminated under this clause.</p>
<p class="cl"><strong>14.2</strong> Either Party may terminate for convenience by giving thirty (30) calendar days&rsquo; written notice.</p>
<p class="cl"><strong>14.3</strong> Either Party may terminate for material breach if the breach is not remedied within fifteen (15) calendar days after written notice describing the breach. No cure period is required where the breach is incapable of remedy or where immediate termination is reasonably necessary due to fraud, unlawful conduct or serious security risk.</p>
<p class="cl"><strong>14.4</strong> Syncro1 may suspend Platform access under Clause 3.4 while investigating a credible concern. Suspension shall be proportionate and shall not be used to avoid payment of earned commissions.</p>
<p class="cl"><strong>14.5</strong> Termination does not affect rights or obligations accrued before termination. Undisputed earned commissions remain payable in accordance with Clause 6. Provisions intended by their nature to survive—including payment, confidentiality, data protection, intellectual property, liability, dispute resolution and the limited protection for existing Protected Opportunities—shall survive.</p>
<p class="cl"><strong>14.6</strong> For Candidates submitted before termination, the Parties shall continue to resolve attribution and pay commission if a Placement occurs within one (1) month after termination, provided the Candidate&rsquo;s hire is reasonably traceable to the Talent Partner&rsquo;s documented submission before termination and the relevant opportunity was active. This survival period does not apply where the Talent Partner was terminated for proven fraud concerning that Candidate.</p>

<!-- 15. RECORDS AND LIMITED AUDIT -->
<div class="art">15. RECORDS AND LIMITED AUDIT</div>
<div class="sart">15. Verification</div>
<p class="cl"><strong>15.1</strong> On reasonable written notice, either Party may request records reasonably necessary to verify submissions, Candidate authorisation, Placement, invoice or payment matters under this Agreement.</p>
<p class="cl"><strong>15.2</strong> Any audit shall be limited in scope, conducted during normal business hours, protect unrelated confidential information and avoid unreasonable disruption. Audits involving personal data must comply with applicable privacy law.</p>
<p class="cl"><strong>15.3</strong> Neither Party may demand unrestricted access to the other Party&rsquo;s systems, unrelated client records, source code or general business books under this clause.</p>

<!-- 16. DISPUTE RESOLUTION AND GOVERNING LAW -->
<div class="art">16. DISPUTE RESOLUTION AND GOVERNING LAW</div>
<div class="sart">16. Disputes</div>
<p class="cl"><strong>16.1</strong> This Agreement is governed by the laws of India.</p>
<p class="cl"><strong>16.2</strong> The Parties shall first attempt in good faith to resolve a dispute through authorised business representatives within fifteen (15) Business Days after written notice of the dispute.</p>
<p class="cl"><strong>16.3</strong> If the dispute remains unresolved, it shall be referred to arbitration in accordance with the Arbitration and Conciliation Act, 1996, as amended from time to time. The tribunal shall consist of a sole independent arbitrator. Syncro1 shall have the first right to propose and nominate the sole arbitrator in writing, and the Talent Partner shall reasonably cooperate in completing the appointment process. The proposed arbitrator shall be independent and impartial, and the appointment shall be subject to applicable law. If the proposed appointment cannot be completed within thirty (30) days of written notice of the dispute being referred to arbitration, or if the appointment is challenged or otherwise cannot lawfully proceed, either Party may seek appointment of the arbitrator through the competent court or other procedure available under Section 11 of the Act. Nothing in this clause shall be construed as permitting an appointment contrary to applicable law. The seat and venue of arbitration shall be Pune, Maharashtra, India.</p>
<p class="cl"><strong>16.4</strong> The seat and legal place of arbitration shall be Pune, Maharashtra. Hearings may be conducted virtually or at another mutually agreed location without changing the seat.</p>
<p class="cl"><strong>16.5</strong> The award shall be final and binding, subject to rights available under applicable law. Courts having jurisdiction at Pune, Maharashtra shall have jurisdiction over court proceedings arising from the arbitration, subject to mandatory jurisdictional rules.</p>
<p class="cl"><strong>16.6</strong> Nothing prevents either Party from seeking urgent interim relief from a competent court or tribunal as permitted by law.</p>

<!-- 17. GENERAL -->
<div class="art">17. GENERAL</div>
<div class="sart">17. Miscellaneous</div>
<p class="cl"><strong>17.1</strong> Notices must be sent by email and, where appropriate, by courier to the contacts in Schedule E. A notice is effective when receipt is acknowledged, or when delivery is otherwise reliably established; termination and breach notices should be sent to both listed contacts where available.</p>
<p class="cl"><strong>17.2</strong> Neither Party may assign this Agreement without the other Party&rsquo;s prior written consent, not to be unreasonably withheld, except to an affiliate or successor in connection with a bona fide merger, reorganisation or sale of substantially all relevant business, provided the assignee assumes the obligations in writing and the assignment does not materially prejudice the other Party.</p>
<p class="cl"><strong>17.3</strong> No amendment or waiver is effective unless in writing and signed or clearly accepted by authorised representatives of both Parties. Platform updates alone do not amend commercial terms.</p>
<p class="cl"><strong>17.4</strong> If a provision is held invalid or unenforceable, it shall be modified only to the minimum extent legally permissible, if permitted by law; otherwise it shall be severed, and the remaining provisions shall continue.</p>
<p class="cl"><strong>17.5</strong> Failure or delay in enforcing a right is not a waiver. Remedies are cumulative to the extent permitted by law.</p>
<p class="cl"><strong>17.6</strong> This Agreement, including its Schedules, constitutes the entire agreement on its subject matter and supersedes prior discussions on that subject, but does not override a separate written client-specific commercial variation signed by both Parties.</p>
<p class="cl"><strong>17.7</strong> This Agreement may be executed in counterparts and by legally valid electronic signature, subject to applicable law. Each Party shall retain the final executed version and evidence of signatory authority.</p>
<p class="cl"><strong>17.8</strong> The Parties shall confirm the applicable stamp duty, stamping method and execution formalities under Maharashtra law before signing. This draft does not determine the stamp duty payable.</p>
<p class="cl"><strong>17.9</strong> No provision creates rights in favour of a third party except where expressly stated or required by law.</p>

<!-- SCHEDULE A -->
<div class="art" style="margin-top:16px;">SCHEDULE A &mdash; COMMERCIAL TERMS</div>
<table>
  <tr>
    <th style="width:30%;">Commercial item</th>
    <th style="width:70%;">Agreed term</th>
  </tr>
  <tr>
    <td><strong>Standard commission</strong></td>
    <td>5% of Fixed Annual CTC, unless a role-specific rate is agreed in writing before submission/shortlisting.</td>
  </tr>
  <tr>
    <td><strong>Commission trigger</strong></td>
    <td>Candidate joins the Client for the relevant Placement.</td>
  </tr>
  <tr>
    <td><strong>Invoice timing</strong></td>
    <td>Talent Partner issues a compliant invoice after joining and supplies reasonable supporting documents.</td>
  </tr>
  <tr>
    <td><strong>Payment deadline</strong></td>
    <td>Post 90 days of candidate joining which covers the standard replacement period</td>
  </tr>
  <tr>
    <td><strong>GST and taxes</strong></td>
    <td>GST, if lawfully chargeable, against a valid tax invoice. Statutory withholding/deductions apply.</td>
  </tr>
  <tr>
    <td><strong>Replacement support</strong></td>
    <td>90 days from joining, subject to Clause 8.</td>
  </tr>
  <tr>
    <td><strong>Role-specific terms</strong></td>
    <td>[Insert role/requisition, agreed commission, special terms and authorised approvals, if any.]</td>
  </tr>
</table>
<p style="font-size:8.8pt; font-style:italic; margin-top:4px;"><strong>Required invoice support (as reasonably applicable):</strong> Candidate name; Client and requisition; joining date confirmation; final offer/Fixed Annual CTC confirmation sufficient to calculate commission; invoice number/date; PAN/GST details; bank details. Personal data must be limited to what is necessary.</p>

<!-- SCHEDULE B -->
<div class="art" style="margin-top:16px;">SCHEDULE B &mdash; OPERATIONAL SERVICE LEVELS</div>
<ol class="num">
  <li>Acknowledge a role assignment within two (2) Business Days, or decline it in the Platform.</li>
  <li>Submit only profiles for which Candidate authorisation has been obtained and recorded.</li>
  <li>Disclose known duplicates or prior submissions before submission.</li>
  <li>Provide reasonable status updates when requested and promptly report interview feedback or Candidate changes known to the Talent Partner.</li>
  <li>Syncro1 will endeavour to provide role details, process updates and attribution decisions in a timely manner, subject to Client responsiveness.</li>
  <li>The Parties recognise that Client decisions, interview scheduling, offers, joining dates and hiring volumes are outside either Party&rsquo;s complete control; no SLA guarantees a Placement.</li>
</ol>

<!-- SCHEDULE C -->
<div class="art" style="margin-top:16px;">SCHEDULE C &mdash; DATA PROCESSING ADDENDUM (CORE TERMS)</div>
<ol class="num">
  <li><strong>Purpose:</strong> process Candidate data only to identify, assess, communicate about and facilitate hiring for the relevant role, and for associated lawful compliance and recordkeeping.</li>
  <li><strong>Data categories:</strong> identity and contact details, CV/work history, qualifications, skills, compensation expectations, notice period, interview and recruitment status, and other role-relevant information. Sensitive or unrelated data should not be collected unless lawful and strictly necessary.</li>
  <li><strong>Roles:</strong> each Party shall document its actual role for each processing activity. Nothing in this Agreement conclusively labels either Party as a data fiduciary/controller or processor where the applicable law and actual processing determine otherwise.</li>
  <li><strong>Security:</strong> access controls, secure transmission, reasonable device/account security, staff confidentiality, incident response and appropriate deletion/retention controls.</li>
  <li><strong>Incidents:</strong> notify the other Party without undue delay and, where practicable, within 48 hours; preserve evidence; cooperate in investigation and lawful notifications.</li>
  <li><strong>Data subject requests:</strong> promptly refer requests to the Party responsible for responding and reasonably assist with access, correction, withdrawal, deletion or grievance handling where applicable.</li>
  <li><strong>Sub-processors and transfers:</strong> no material third-party processing or cross-border transfer on behalf of the other Party where consent, notice, contractual controls or other safeguards are legally required unless those requirements have been satisfied.</li>
  <li><strong>Retention:</strong> delete or de-identify data when no longer required for the recruitment purpose, subject to lawful retention, dispute preservation and documented audit needs.</li>
  <li>This Schedule must be expanded or replaced by a tailored data-processing agreement if required by the Parties&rsquo; actual platform architecture, client contracts or applicable law.</li>
</ol>

<!-- SCHEDULE D -->
<div class="art" style="margin-top:16px;">SCHEDULE D &mdash; TALENT PARTNER DUE-DILIGENCE CHECKLIST</div>
<ul class="bul" style="list-style-type:none; margin-left:5px;">
  <li>&#9744; Legal name and constitution of business confirmed</li>
  <li>&#9744; PAN and GSTIN (if applicable) verified</li>
  <li>&#9744; Registered/principal address and authorized signatory confirmed</li>
  <li>&#9744; Bank account details independently verified</li>
  <li>&#9744; Relevant business registrations, if applicable</li>
  <li>&#9744; Candidate authorisation and data-handling process confirmed</li>
  <li>&#9744; Conflict-of-interest and anti-bribery expectations communicated</li>
  <li>&#9744; Contact details for legal, operational and payment notices confirmed</li>
</ul>

<!-- SCHEDULE E -->
<div class="art" style="margin-top:16px;">SCHEDULE E &mdash; NOTICE DETAILS</div>
<table>
  <tr>
    <th style="width:25%;">Party</th>
    <th style="width:35%;">Email for notices</th>
    <th style="width:40%;">Postal address</th>
  </tr>
  <tr>
    <td><strong>Syncro1</strong></td>
    <td>legal@syncro1.com</td>
    <td>H801 Tiana Bldg Bellacasa, Sr No.42(P),43(P) 44(P), Sus, Haveli, Pune- 411021, Maharashtra</td>
  </tr>
  <tr>
    <td><strong>Talent Partner</strong></td>
    <td>${partnerData.email || '[●]'}</td>
    <td>${partnerAddress}</td>
  </tr>
</table>

<!-- SIGNATURES -->
<div class="art" style="margin-top:18px;">SIGNATURES</div>
<p class="cl">The Parties confirm that they have read and understood this Agreement and that the signatories below are authorised to bind the respective Parties.</p>

<div class="sig-wrap">
  <table class="sig-grid">
    <tr>
      <td>
        <div class="sig-lbl">For and on behalf of</div>
        <div class="sig-name">Syncro1 Private Limited</div>
        <div class="sf"><strong>Name:</strong> Abhishek Bartakke</div>
        <div class="sf"><strong>Title/Capacity:</strong> Director</div>
        <div class="sf" style="display:flex; align-items:center; gap:8px; min-height:36px; margin:3px 0;">
          <strong>Signature:</strong>
          ${abhiSignatureImg ? `
            <img src="${abhiSignatureImg}" alt="Abhishek Bartakke Signature" style="height:34px; width:auto; vertical-align:middle; mix-blend-mode:multiply;" />
          ` : `
            <span>___________________________</span>
          `}
        </div>
        <div class="sf"><strong>Date:</strong> ${formattedDate}</div>
        <div class="sf"><strong>Place:</strong> Pune, Maharashtra</div>
      </td>
      <td>
        <div class="sig-lbl">For and on behalf of</div>
        <div class="sig-name">${partnerLegalName}</div>
        <div class="sf"><strong>Name:</strong> ${signatoryName}</div>
        <div class="sf"><strong>Title/Capacity:</strong> ${partnerDesignation}</div>
        <div class="sf" style="display:flex; align-items:center; gap:8px; min-height:36px; margin:3px 0;">
          <strong>Signature:</strong>
          ${partnerSigImg ? `
            <img src="${partnerSigImg}" alt="Authorised Signatory Signature" style="height:34px; max-width:140px; width:auto; vertical-align:middle; mix-blend-mode:multiply;" />
          ` : (agreedAt ? `
            <span style="font-family:'Brush Script MT', 'Dancing Script', 'Segoe Script', cursive; font-size:15pt; color:#1e3a8a; line-height:1;">${signatoryName}</span>
            <span style="display:inline-block; font-size:7pt; color:#15803d; font-weight:bold; background:#dcfce7; border:0.5px solid #86efac; border-radius:3px; padding:1px 5px; vertical-align:middle; font-family:sans-serif;">&#10003; Digitally Signed</span>
          ` : `
            <span>___________________________</span>
          `)}
        </div>
        <div class="sf"><strong>Date:</strong> ${formattedDate}</div>
        <div class="sf"><strong>Place:</strong> ${partnerPlace}</div>
        ${agreedAt ? `
        <div class="sig-accepted">
          <div class="sa-text">&#10003; Digitally Accepted on Syncro1 Platform</div>
          <div class="sa-meta">
            <strong>Accepted At:</strong> ${agreedDateTime}<br>
            <strong>IP Address:</strong> ${agreedIp || 'N/A'}<br>
            <strong>Entity PAN:</strong> ${panNumber || 'N/A'}
          </div>
        </div>
        ` : `
        <div class="sig-blank">Pending Partner Digital Acceptance</div>
        `}
      </td>
    </tr>
  </table>
</div>

<!-- PRE-SIGNING LEGAL CHECKLIST -->
<div class="art" style="margin-top:16px;">PRE-SIGNING LEGAL CHECKLIST &mdash; DO NOT OMIT</div>
<ul class="bul" style="list-style-type:none; margin-left:5px; font-size:8.8pt;">
  <li>&#9744; Confirm the exact contracting entity behind Syncro1 and insert its legal name, registration details, address and authorised signatory.</li>
  <li>&#9744; Have Maharashtra counsel determine the applicable stamp duty, stamping method and any execution formalities for the final instrument.</li>
  <li>&#9744; Confirm whether the parties are businesses, individuals or sole proprietors and whether the actual operating model creates any employment, labour, tax or other statutory obligations.</li>
  <li>&#9744; Review the limited non-circumvention clause against Section 27 of the Indian Contract Act, 1872 and applicable case law; do not assume a 12-month period is automatically enforceable.</li>
  <li>&#9744; Confirm the liability cap and whether a separately negotiated super-cap is appropriate. This draft intentionally leaves no numerical super-cap as an automatic term.</li>
  <li>&#9744; Check the DPDP Act/Rules commencement dates and all other applicable privacy and information-security requirements as of the execution date; tailor Schedule C to actual data flows and client contracts.</li>
  <li>&#9744; Check the arbitration appointment mechanism, seat, jurisdiction and electronic execution process against current law.</li>
  <li>&#9744; Ensure the commission rate, CTC definition, payment clock, replacement policy and survival period align with Syncro1&rsquo;s client contracts and internal operating process.</li>
  <li>&#9744; Remove this checklist and all drafting notes from the execution copy after legal approval.</li>
</ul>

<!-- LEGAL REFERENCE NOTES -->
<div class="art" style="margin-top:16px;">LEGAL REFERENCE NOTES (FOR COUNSEL; NOT OPERATIVE TERMS)</div>
<p style="font-size:8.5pt; text-align:justify; margin-bottom:4px;">Key provisions to verify against current official sources include the Indian Contract Act, 1872 (including Sections 27, 73 and 74); the Arbitration and Conciliation Act, 1996 (including Section 11); the Maharashtra Stamp Act and applicable schedule; relevant Maharashtra Shops and Establishments legislation where applicable; and the Digital Personal Data Protection Act, 2023 and its staged commencement notifications/Rules.</p>
<p style="font-size:8.5pt; text-align:justify;">The statutory commencement schedule for the DPDP Act is staged. As at the date of this draft, the commencement notification dated 13 November 2025 schedules many substantive provisions for commencement 18 months after publication (13 May 2027), while specified provisions have earlier dates. Counsel should verify the current position at signing and should not treat the Act as wholly in force merely because the Rules have been notified.</p>

<!-- TALENT PARTNER RECORD AUDIT TABLE -->
<div class="sch-title" style="margin-top:16px; font-weight:bold; font-size:9.5pt; text-transform:uppercase;">TALENT PARTNER PROFILE &amp; ACCEPTANCE AUDIT RECORD</div>
<div class="vr">
  <div class="vr-title">Syncro1 Platform Cryptographic &amp; Acceptance Record</div>
  <div class="vr-row"><span class="vr-lbl">Legal Entity Name</span><span class="vr-val"><strong>${partnerLegalName}</strong></span></div>
  <div class="vr-row"><span class="vr-lbl">Entity Type</span><span class="vr-val">${partnerType}</span></div>
  <div class="vr-row"><span class="vr-lbl">Registered Address</span><span class="vr-val">${partnerAddress}</span></div>
  <div class="vr-row"><span class="vr-lbl">PAN Number</span><span class="vr-val">${panNumber || 'N/A'}</span></div>
  <div class="vr-row"><span class="vr-lbl">GST Number</span><span class="vr-val">${gstNumber || 'N/A'}</span></div>
  <div class="vr-row"><span class="vr-lbl">CIN / Registration</span><span class="vr-val">${cinNumber || 'N/A'}</span></div>
  <div class="vr-row"><span class="vr-lbl">Authorised Signatory</span><span class="vr-val"><strong>${signatoryName}</strong></span></div>
  <div class="vr-row"><span class="vr-lbl">Designation</span><span class="vr-val">${partnerDesignation}</span></div>
  <div class="vr-row"><span class="vr-lbl">Agreement Accepted On</span><span class="vr-val"><strong>${agreedDateTime}</strong></span></div>
  <div class="vr-row"><span class="vr-lbl">IP Address at Acceptance</span><span class="vr-val">${agreedIp || 'N/A'}</span></div>
</div>

<!-- FOOTER -->
<div class="doc-footer">
  Document Reference: MSA-${Date.now()} &bull; Generated: ${new Date().toLocaleString('en-IN')} &bull; &copy; ${new Date().getFullYear()} Syncro1 Private Limited. All rights reserved.
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
      'Agency': 'Recruitment Agency registered under applicable law',
      'Individual': 'Individual residing and operating under the laws of India'
    };
    return map[type] || type || 'company/LLP/partnership/proprietorship/individual organised under the laws of India';
  }

  _formatAddress(address) {
    if (!address) return '[Principal Address of Talent Partner]';
    if (typeof address === 'string') return address;
    return [
      address.street,
      address.city,
      address.state,
      address.pincode,
      address.country
    ].filter(Boolean).join(', ') || '[Principal Address of Talent Partner]';
  }
}

module.exports = new AgreementTemplateService();
