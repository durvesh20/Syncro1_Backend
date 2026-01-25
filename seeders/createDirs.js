// backend/scripts/createDirs.js
const fs = require('fs');
const path = require('path');

const directories = [
  'uploads',
  'uploads/resumes',
  'uploads/documents',
  'uploads/logos',
  'uploads/others',
  'logs'
];

console.log('📁 Creating directories...\n');

directories.forEach(dir => {
  const dirPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✅ Created: ${dir}`);
  } else {
    console.log(`ℹ️  Exists: ${dir}`);
  }
});

// Create .gitkeep files to keep empty directories in git
directories.forEach(dir => {
  const gitkeepPath = path.join(__dirname, '..', dir, '.gitkeep');
  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, '');
  }
});

console.log('\n🎉 All directories ready!');