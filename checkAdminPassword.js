const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("./models/User");
require("dotenv").config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const newPassword = "Admin@123";
  const hash = await bcrypt.hash(newPassword, 10);

  await User.updateOne(
    { email: "admin@syncro1.com" },
    { password: hash }
  );

  console.log("✅ Password reset successful");
  process.exit(0);
})();