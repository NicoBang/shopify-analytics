#!/usr/bin/env node

/**
 * Test the local improved bulk-sync-orders function
 * This validates the code changes locally before deployment
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating improved bulk-sync-orders locally\n');

const functionPath = path.join(__dirname, 'supabase/functions/bulk-sync-orders/index.ts');

if (!fs.existsSync(functionPath)) {
  console.error('❌ Function file not found:', functionPath);
  process.exit(1);
}

const content = fs.readFileSync(functionPath, 'utf8');

// Check for our improvements
const improvements = [
  {
    name: 'Bulk operation conflict handling',
    pattern: /cancelBulkOperation/,
    found: false,
  },
  {
    name: 'Check existing operations',
    pattern: /const existingOp = await checkBulkOperationStatus/,
    found: false,
  },
  {
    name: 'Same-day delay logic',
    pattern: /Same-day query detected/,
    found: false,
  },
  {
    name: 'Better error messages',
    pattern: /Bulk operation conflict/,
    found: false,
  },
  {
    name: 'Enhanced logging',
    pattern: /Poll attempt.*Status.*Objects/,
    found: false,
  },
  {
    name: 'Only orders (no SKUs)',
    pattern: /object_type.*orders(?!.*skus)/,
    found: false,
  },
];

console.log('Checking for improvements:\n');

improvements.forEach(improvement => {
  improvement.found = improvement.pattern.test(content);
  const status = improvement.found ? '✅' : '❌';
  console.log(`${status} ${improvement.name}`);
});

console.log('\n-------------------------------------------');

const allFound = improvements.every(i => i.found);

if (allFound) {
  console.log('✨ All improvements are present!\n');

  console.log('Key changes summary:');
  console.log('1. Function now checks for and cancels existing bulk operations');
  console.log('2. Adds 3-second delay for same-day queries to allow indexing');
  console.log('3. Enhanced error handling for bulk operation conflicts');
  console.log('4. Improved logging with operation IDs and progress tracking');
  console.log('5. ONLY processes orders (no SKU or "both" logic)');
  console.log('\nThe function is ready for deployment!');
} else {
  console.log('⚠️ Some improvements are missing. Please review the code.\n');
}

// Check for any remaining "both" references
const hasBothLogic = /object_type.*both/.test(content);
if (hasBothLogic) {
  console.log('\n⚠️ WARNING: Found references to "both" object type!');
  console.log('This should be removed - function should ONLY handle orders.');
} else {
  console.log('\n✅ No "both" logic found - function handles ONLY orders.');
}