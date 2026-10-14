console.log('Waiting before fixture cleanup; cancellation must keep the marker.');
setTimeout(() => { require('node:fs').rmSync('prepared.json', { force: true }); console.log('Fixture cleaned.'); }, 10000);
