const fs = require('node:fs');
fs.writeFileSync('prepared.json', JSON.stringify({ scope: 'isolated-hook-fixture', ready: true }));
console.log('Prepared isolated fixture. Token must be redacted:', process.env.QA_TOKEN || 'not configured');
