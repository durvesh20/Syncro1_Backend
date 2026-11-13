// backend/scripts/createSuperAdmin.js
const path = require('path');
const dotenv = require('dotenv');

// Load .env.development by default if NODE_ENV is not production
const envPath = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../.env.production')
  : path.resolve(__dirname, '../.env.development');

dotenv.config({ path: envPath });

const mongoose = require('mongoose');
const User = require('../models/User');

const createOrUpdateSuperAdmin = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ MONGO_URI not found in environment');
    process.exit(1);
  }

  try {
    console.log(`Connecting to MongoDB (${envPath})...`);
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected');

    const email = 'yogesh@syncro1.com';
    let user = await User.findOne({ email });

    if (!user) {
      // Find an available unique mobile number
      let testMobile = '9999999998';
      let existingMobile = await User.findOne({ mobile: testMobile });
      let counter = 8;
      while (existingMobile && counter > 0) {
        counter--;
        testMobile = `999999999${counter}`;
        existingMobile = await User.findOne({ mobile: testMobile });
      }

      user = await User.create({
        email,
        mobile: testMobile,
        password: 'Admin@123',
        role: 'super_admin',
        status: 'ACTIVE',
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });
      console.log('✅ Created new Super Admin user:');
    } else {
      user.role = 'super_admin';
      user.status = 'ACTIVE';
      user.emailVerified = true;
      user.mobileVerified = true;
      user.password = 'Admin@123';
      await user.save();
      console.log('✅ Updated existing user to Super Admin:');
    }

    console.log({
      id: user._id,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      mobileVerified: user.mobileVerified
    });
    console.log('\n=======================================');
    console.log('  CREDENTIALS FOR DEV:');
    console.log('  Email:    yogesh@syncro1.com');
    console.log('  Password: Admin@123');
    console.log(`  Mobile:   ${user.mobile}`);
    console.log('  Role:     super_admin');
    console.log('=======================================\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating Super Admin:', error.message);
    if (mongoose.connection) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
};

createOrUpdateSuperAdmin();
