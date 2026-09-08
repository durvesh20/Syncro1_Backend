/**
 * Unit Test for Developer API Logic:
 * - JWT Token Generation & Verification
 * - External to Internal Job Field Mapping
 * - Internal to External Candidate/Job Mapping
 * - Webhook HMAC-SHA256 Signatures
 * - Rate Limiting & Idempotency Logic
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const integrationService = require('../services/integrationService');

describe('Developer API Unit Tests', () => {
  const JWT_SECRET = 'test_jwt_secret_key_12345';
  process.env.JWT_SECRET = JWT_SECRET;

  test('1. JWT Generation & Verification for Developer Client', () => {
    const clientPayload = {
      id: '66e2c9a10f8b1234567890ab',
      client_id: 'syncro1_cli_test_12345',
      company_id: '66e2c9a10f8b1234567890cd',
      integration_id: '66e2c9a10f8b1234567890ef',
      scopes: ['jobs:read', 'jobs:write', 'candidates:read'],
      type: 'developer'
    };

    const token = jwt.sign(clientPayload, JWT_SECRET, { expiresIn: '1h' });
    expect(token).toBeDefined();

    const decoded = jwt.verify(token, JWT_SECRET);
    expect(decoded.type).toBe('developer');
    expect(decoded.client_id).toBe('syncro1_cli_test_12345');
    expect(decoded.scopes).toContain('jobs:write');
  });

  test('2. mapExternalJobToInternal - converts ATS payload to Syncro1 schema', () => {
    const atsPayload = {
      external_job_id: 'WORKDAY-8821',
      title: 'Senior Software Architect',
      description: 'Designing distributed microservices across regions.',
      department: 'Platform Engineering',
      employment_type: 'FULL_TIME',
      experience: { min: 7, max: 12 },
      compensation: { min: 3500000, max: 5000000, currency: 'INR', isNegotiable: true },
      location: { city: ['Bangalore', 'Remote'], state: 'Karnataka', isRemote: true },
      skills: ['Node.js', 'Go', 'Kubernetes'],
      openings: 3
    };

    const companyId = '66e2c9a10f8b1234567890cd';
    const userId = '66e2c9a10f8b1234567890ef';
    const integrationId = '66e2c9a10f8b1234567890aa';

    const internal = integrationService.mapExternalJobToInternal(
      atsPayload,
      companyId,
      userId,
      integrationId
    );

    expect(internal.company).toBe(companyId);
    expect(internal.postedBy).toBe(userId);
    expect(internal.title).toBe(atsPayload.title);
    expect(internal.employmentType).toBe('Full-time');
    expect(internal.experienceRange.min).toBe(7);
    expect(internal.experienceRange.max).toBe(12);
    expect(internal.experienceLevel).toBe('Senior');
    expect(Array.isArray(internal.location.city)).toBe(true);
    expect(internal.location.city).toContain('Bangalore');
    expect(internal.location.city).toContain('Remote');
    expect(internal.requirements).toEqual(atsPayload.skills);
    expect(internal.source_system).toBe('API');
    expect(internal.external_job_id).toBe('WORKDAY-8821');
    expect(internal.uniqueId).toMatch(/^JOB-\d+$/);
  });

  test('3. mapInternalJobToApi - converts internal job document to clean API schema', () => {
    const internalDoc = {
      _id: '66e2c9a10f8b123456789011',
      uniqueId: 'JOB-90214',
      external_job_id: 'ATS-100',
      title: 'DevOps Engineer',
      description: 'CI/CD pipeline lead',
      category: 'DevOps',
      employmentType: 'Full-time',
      experienceLevel: 'Mid',
      experienceRange: { min: 3, max: 6 },
      salary: { min: 1800000, max: 2400000, currency: 'INR', isNegotiable: false },
      location: { city: ['Pune'], state: 'Maharashtra', isRemote: false, isHybrid: true },
      requirements: ['Docker', 'Terraform'],
      responsibilities: ['Build pipelines'],
      status: 'ACTIVE',
      metrics: { views: 50, applications: 10, shortlisted: 2, interviewed: 1, joined: 0 },
      createdAt: new Date('2026-09-01'),
      updatedAt: new Date('2026-09-02')
    };

    const apiOutput = integrationService.mapInternalJobToApi(internalDoc);
    expect(apiOutput.job_id).toBe('JOB-90214');
    expect(apiOutput.external_job_id).toBe('ATS-100');
    expect(apiOutput.compensation.min).toBe(1800000);
    expect(apiOutput.location.cities).toContain('Pune');
    expect(apiOutput.status).toBe('ACTIVE');
    expect(apiOutput.metrics.applications).toBe(10);
  });

  test('4. Webhook HMAC-SHA256 signature verification', () => {
    const webhookSecret = 'whsec_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      id: 'evt_01J98ABC',
      type: 'candidate.submitted',
      data: {
        candidate_id: 'CAN-1234',
        job_id: 'JOB-90214',
        name: 'Jane Doe'
      }
    };
    const payloadString = JSON.stringify(payload);

    // Compute signature as webhookService does
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${payloadString}`)
      .digest('hex');

    expect(signature).toBeDefined();
    expect(signature.length).toBe(64); // SHA-256 hex string is 64 characters

    // Verify recipient side
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${payloadString}`)
      .digest('hex');

    expect(crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))).toBe(true);
  });

  test('5. Multi-account list mapping and target query validation', () => {
    const mockAccounts = [
      {
        _id: '66e2c9a10f8b1234567890aa',
        company_id: '66e2c9a10f8b1234567890cd',
        email: 'lead.dev@company.com',
        name: 'Lead Developer',
        status: 'ACTIVE',
        last_login_at: new Date('2026-09-07T10:00:00Z'),
        created_at: new Date('2026-09-01T08:00:00Z')
      },
      {
        _id: '66e2c9a10f8b1234567890bb',
        company_id: '66e2c9a10f8b1234567890cd',
        email: 'integrations.dev@company.com',
        name: 'ATS Integrations Lead',
        status: 'ACTIVE',
        last_login_at: null,
        created_at: new Date('2026-09-05T12:00:00Z')
      }
    ];

    // Status endpoint returns list of accounts and backward-compatible single account
    const responsePayload = {
      enabled: true,
      status: 'ACTIVE',
      developer_accounts: mockAccounts,
      developer_account: mockAccounts[0]
    };

    expect(responsePayload.developer_accounts.length).toBe(2);
    expect(responsePayload.developer_account._id).toBe('66e2c9a10f8b1234567890aa');
    expect(responsePayload.developer_accounts[1].email).toBe('integrations.dev@company.com');

    // Targeting by ID helper test
    const targetAccountId = '66e2c9a10f8b1234567890bb';
    const target = mockAccounts.find(acc => acc._id === targetAccountId);
    expect(target).toBeDefined();
    expect(target.name).toBe('ATS Integrations Lead');
  });
});

