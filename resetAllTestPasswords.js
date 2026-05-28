const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const User = require('./models/User');
const connectDB = require('./config/db');

const resetPasswords = async () => {
    try {
        await connectDB();
        console.log('Connected to MongoDB\n');

        const testUsers = [
            { email: 'admin@syncro1.com', password: 'Admin@123' },
            { email: 'subadmin@syncro1.com', password: 'SubAdmin@123' },
            { email: 'partner@test.com', password: 'Partner@123' },
            { email: 'company@test.com', password: 'Company@123' }
        ];

        for (const testUser of testUsers) {
            const user = await User.findOne({
                email: testUser.email.toLowerCase()
            });

            if (user) {
                user.password = testUser.password;
                await user.save();
                console.log(`✅ Password reset: ${testUser.email} → ${testUser.password}`);
            } else {
                console.log(`⚠️  User not found: ${testUser.email}`);
            }
        }

        console.log('\n🎉 All test passwords reset!\n');
        console.log('Test Credentials:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Admin:      admin@syncro1.com / Admin@123');
        console.log('Sub-Admin:  subadmin@syncro1.com / SubAdmin@123');
        console.log('Partner:    partner@test.com / Partner@123');
        console.log('Company:    company@test.com / Company@123');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
};

resetPasswords();