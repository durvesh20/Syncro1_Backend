const dotenv = require('dotenv');
const path = require('path');

const env = process.env.NODE_ENV || 'development';
const envPath = path.resolve(process.cwd(), `.env.${env}`);

const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error(`❌ Could not load ${envPath}`);
  throw result.error;
}

console.log(`✅ Loaded .env.${env} from ${envPath}`);