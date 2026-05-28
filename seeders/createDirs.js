// backend/seeders/createDirs.js
const fs = require('fs');
const path = require('path');

const directories = [
  'uploads',
  'uploads/resumes',
  'uploads/documents',
  'uploads/logos',
  'uploads/agreements',
  'uploads/others',
  'logs',
  'temp'
];

console.log('\n📁 Creating required directories...\n');

let created = 0;
let existed = 0;

directories.forEach(dir => {
  const dirPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`  ✅ Created: ${dir}`);
    created++;
  } else {
    console.log(`  ℹ️  Exists:  ${dir}`);
    existed++;
  }

  // Create .gitkeep to preserve empty dirs in git
  const gitkeepPath = path.join(dirPath, '.gitkeep');
  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, '');
  }
});

console.log(`\n✨ Done! Created: ${created} | Already existed: ${existed}\n`);