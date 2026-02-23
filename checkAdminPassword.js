const dotenv = require("dotenv");
dotenv.config();

const bcrypt = require("bcryptjs"); // use bcryptjs since your project uses bcryptjs in User model
const connectDB = require("./config/db");
const User = require("./models/User");

(async () => {
  try {
    await connectDB();

    const adminEmail = "admin@syncro1.com";
    const plainPassword = "Admin@123"; // <-- put the password you want to test

    const admin = await User.findOne({ email: adminEmail }).select("+password");
    if (!admin) {
      console.log("Admin not found");
      process.exit(0);
    }

    console.log("Hash exists:", !!admin.password);
    const match = await bcrypt.compare(plainPassword, admin.password);
    console.log("Password match:", match);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
})();