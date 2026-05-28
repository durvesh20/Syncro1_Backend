const dotenv = require("dotenv");
dotenv.config();

const connectDB = require("./config/db");
const User = require("./models/User");

(async () => {
  try {
    await connectDB();

    const admin = await User.findOne({ email: "admin@syncro1.com" }).select("+password");
    if (!admin) {
      console.log("Admin not found");
      process.exit(0);
    }

    admin.password = "Admin@123"; // ✅ plaintext
    admin.isPasswordChanged = true;
    admin.status = "ACTIVE";

    await admin.save();

    console.log("✅ Admin password reset to Admin@123");
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
})();