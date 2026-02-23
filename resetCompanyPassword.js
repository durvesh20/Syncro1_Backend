const dotenv = require("dotenv");
dotenv.config();

const connectDB = require("./config/db");
const User = require("./models/User");

(async () => {
  try {
    await connectDB();

    const email = "ayesha.sharma@techminds.com";
    const newPassword = "Ayesha@123"; // plaintext; pre-save hashes it // "Company@123";

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      console.log("User not found");
      process.exit(0);
    }

    user.password = newPassword;     // plaintext; pre-save hashes it
    user.isPasswordChanged = true;   // no forced change
    // keep status as-is (UNDER_VERIFICATION) or set ACTIVE if you want:
    // user.status = "ACTIVE";

    await user.save();

    console.log(`✅ Password reset for ${email} -> ${newPassword}`);
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
})();