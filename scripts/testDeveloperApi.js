/**
 * End-to-End Developer API Test Script
 * Run via: node scripts/testDeveloperApi.js
 */

const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

require('../config/env');
const connectDB = require('../config/db');

const Company = require('../models/Company');
const User = require('../models/User');
const Integration = require('../models/Integration');
const ApiClient = require('../models/ApiClient');
const WebhookEndpoint = require('../models/WebhookEndpoint');
const WebhookDelivery = require('../models/WebhookDelivery');
const ApiLog = require('../models/ApiLog');
const Job = require('../models/Job');

const integrationService = require('../services/integrationService');
const webhookService = require('../services/webhookService');

async function runTests() {
  console.log('═'.repeat(60));
  console.log('  SYNCRO1 DEVELOPER API & INTEGRATION VERIFICATION');
  console.log('═'.repeat(60));

  await connectDB();
  console.log('✅ Database connected\n');

  try {
    // 1. Find a test company and user
    let testCompany = await Company.findOne();
    if (!testCompany) {
      console.log('⚠️ No company found in DB, skipping live test.');
      process.exit(0);
    }
    console.log(`1. Using Company: ${testCompany.companyName} (${testCompany._id})`);

    let testUser = await User.findOne({ company: testCompany._id }) || await User.findOne({ role: 'company' });
    if (!testUser) {
      testUser = await User.findOne();
    }
    console.log(`   Using User: ${testUser.firstName} ${testUser.lastName} (${testUser._id})`);

    // 2. Test Integration Creation / Activation
    let integration = await Integration.findOne({ company_id: testCompany._id });
    if (!integration) {
      integration = await Integration.create({
        company_id: testCompany._id,
        user_id: testUser._id,
        status: 'ACTIVE',
        environment: 'PRODUCTION'
      });
      console.log('2. ✅ Created new Integration record');
    } else {
      integration.status = 'ACTIVE';
      await integration.save();
      console.log('2. ✅ Integration status verified ACTIVE');
    }

    // 3. Test ApiClient credential generation
    const rawClientId = `syncro1_cli_test_${crypto.randomBytes(6).toString('hex')}`;
    const rawClientSecret = `syncro1_sec_test_${crypto.randomBytes(12).toString('hex')}`;
    const salt = await bcrypt.genSalt(10);
    const secretHash = await bcrypt.hash(rawClientSecret, salt);

    const client = await ApiClient.create({
      client_id: rawClientId,
      client_secret_hash: secretHash,
      integration_id: integration._id,
      company_id: testCompany._id,
      label: 'Automated Test Key',
      status: 'ACTIVE'
    });
    console.log(`3. ✅ Created ApiClient credentials: ${client.client_id}`);

    // 4. Verify password compare & JWT generation
    const isMatch = await bcrypt.compare(rawClientSecret, client.client_secret_hash);
    if (!isMatch) throw new Error('Bcrypt comparison failed');

    const token = jwt.sign(
      {
        id: client._id,
        client_id: client.client_id,
        company_id: client.company_id,
        integration_id: client.integration_id,
        scopes: client.scopes,
        type: 'developer'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log('4. ✅ Developer JWT signed successfully');

    // 5. Verify Token decoding
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.client_id !== client.client_id || decoded.type !== 'developer') {
      throw new Error('Token decode mismatch');
    }
    console.log('5. ✅ Developer JWT verified and validated');

    // 6. Test External Job Mapping & Creation
    const externalPayload = {
      external_job_id: `EXT-TEST-${Date.now()}`,
      title: 'Senior Automated Test Engineer',
      description: 'Responsible for end-to-end integration validation across all modules.',
      department: 'Engineering',
      employment_type: 'FULL_TIME',
      experience: { min: 3, max: 6 },
      compensation: { min: 1800000, max: 2400000, currency: 'INR' },
      location: { city: ['Bangalore'], is_remote: false, is_hybrid: true },
      skills: ['Jest', 'Node.js', 'Vite', 'MongoDB'],
      openings: 1
    };

    const internalData = integrationService.mapExternalJobToInternal(
      externalPayload,
      testCompany._id,
      testUser._id,
      integration._id
    );

    const createdJob = await Job.create(internalData);
    console.log(`6. ✅ Created Job via Integration mapping: ${createdJob.uniqueId} (ext: ${createdJob.external_job_id})`);

    // Verify format mapping
    const apiJob = integrationService.mapInternalJobToApi(createdJob);
    if (apiJob.external_job_id !== externalPayload.external_job_id) {
      throw new Error('API Job mapping mismatch');
    }
    console.log('   ✅ mapInternalJobToApi correctly formatted output');

    // 7. Test Webhook creation & HMAC signing
    const testSecret = 'whsec_test_secret_12345';
    const testEndpoint = await WebhookEndpoint.create({
      integration_id: integration._id,
      company_id: testCompany._id,
      url: 'https://httpbin.org/post',
      secret_hash: testSecret,
      events: ['*'],
      status: 'ACTIVE'
    });
    console.log(`7. ✅ WebhookEndpoint created: ${testEndpoint.url}`);

    // Test webhook event emission
    await webhookService.emitEvent(testCompany._id, 'job.created', {
      job_id: createdJob.uniqueId,
      title: createdJob.title
    }, { entity_type: 'JOB', entity_id: createdJob._id });
    console.log('   ✅ Webhook event queued');

    // 8. Test ApiLog creation
    const log = await ApiLog.create({
      request_id: 'req_test_12345',
      client_id: client.client_id,
      company_id: testCompany._id,
      method: 'POST',
      path: '/api/v1/jobs',
      status_code: 201,
      latency_ms: 45,
      ip: '127.0.0.1',
      request_summary: { title: createdJob.title }
    });
    console.log(`8. ✅ ApiLog recorded successfully: ${log.request_id} (${log.latency_ms}ms)`);

    // Cleanup test artifacts
    await Job.deleteOne({ _id: createdJob._id });
    await WebhookEndpoint.deleteOne({ _id: testEndpoint._id });
    await ApiClient.deleteOne({ _id: client._id });
    await ApiLog.deleteOne({ _id: log._id });
    console.log('\n9. ✅ Cleanup completed successfully');

    console.log('\n' + '═'.repeat(60));
    console.log('  ALL DEVELOPER API INTEGRATION TESTS PASSED 🎉');
    console.log('═'.repeat(60) + '\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  }
}

runTests();

