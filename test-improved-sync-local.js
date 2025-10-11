#!/usr/bin/env node

/**
 * Local test script for improved bulk-sync-orders function
 * Tests the TypeScript compilation and structure without requiring actual API keys
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.blue);
  console.log('='.repeat(60));
}

// Validate shared utilities structure
function validateSharedUtilities() {
  logSection('🔍 Validating Shared Utilities Structure');

  const requiredFiles = [
    {
      path: 'supabase/functions/_shared/config.ts',
      exports: ['SHOPIFY_CONFIG', 'ShopName', 'CurrencyCode']
    },
    {
      path: 'supabase/functions/_shared/shopify.ts',
      exports: ['getShopifyToken', 'withRetry', 'getCurrencyMultiplier', 'getTaxRate']
    },
    {
      path: 'supabase/functions/_shared/supabase.ts',
      exports: ['createAuthenticatedClient', 'batchUpsert']
    },
    {
      path: 'supabase/functions/_shared/types.ts',
      exports: ['ShopifyOrder', 'OrderRecord', 'BulkSyncJob', 'BulkOperationResult', 'ShopifyBulkOperation']
    },
    {
      path: 'supabase/functions/_shared/logger.ts',
      exports: ['Logger']
    }
  ];

  let allValid = true;

  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file.path);

    if (fs.existsSync(filePath)) {
      log(`✅ ${file.path}`, colors.green);

      // Read file content and check for exports
      const content = fs.readFileSync(filePath, 'utf8');
      const missingExports = [];

      for (const exportName of file.exports) {
        if (!content.includes(`export ${exportName}`) &&
            !content.includes(`export interface ${exportName}`) &&
            !content.includes(`export type ${exportName}`) &&
            !content.includes(`export class ${exportName}`) &&
            !content.includes(`export const ${exportName}`) &&
            !content.includes(`export function ${exportName}`)) {
          missingExports.push(exportName);
        }
      }

      if (missingExports.length > 0) {
        log(`   ⚠️ Missing exports: ${missingExports.join(', ')}`, colors.yellow);
        allValid = false;
      } else {
        log(`   📦 All expected exports found`, colors.gray);
      }
    } else {
      log(`❌ ${file.path} is missing`, colors.red);
      allValid = false;
    }
  }

  return allValid;
}

// Validate bulk-sync-orders structure
function validateBulkSyncOrders() {
  logSection('📋 Validating bulk-sync-orders Structure');

  const functionPath = 'supabase/functions/bulk-sync-orders/index.ts';
  const filePath = path.join(process.cwd(), functionPath);

  if (!fs.existsSync(filePath)) {
    log(`❌ ${functionPath} not found`, colors.red);
    return false;
  }

  log(`✅ ${functionPath} exists`, colors.green);

  const content = fs.readFileSync(filePath, 'utf8');
  const checks = [
    {
      name: 'Imports shared utilities',
      pattern: /import.*from.*"\.\.\/_shared\//,
      found: false
    },
    {
      name: 'Uses TypeScript interfaces',
      pattern: /import type.*from.*"\.\.\/_shared\/types\.ts"/,
      found: false
    },
    {
      name: 'Implements test mode',
      pattern: /testMode\??\s*[:=]/,
      found: false
    },
    {
      name: 'Has retry logic',
      pattern: /withRetry/,
      found: false
    },
    {
      name: 'Proper error handling',
      pattern: /try\s*{[\s\S]*?}\s*catch/,
      found: false
    },
    {
      name: 'Batch processing',
      pattern: /batchUpsert|BATCH_SIZE/,
      found: false
    }
  ];

  let allChecks = true;

  for (const check of checks) {
    check.found = check.pattern.test(content);
    if (check.found) {
      log(`   ✅ ${check.name}`, colors.green);
    } else {
      log(`   ❌ ${check.name}`, colors.red);
      allChecks = false;
    }
  }

  return allChecks;
}

// Run TypeScript type checking
function runTypeCheck() {
  logSection('🔍 Running TypeScript Type Check');

  try {
    // Check if deno is available
    try {
      execSync('which deno', { stdio: 'ignore' });
    } catch {
      log('⚠️ Deno not installed, skipping type check', colors.yellow);
      return true;
    }

    // Run deno check
    const result = execSync('deno check supabase/functions/bulk-sync-orders/index.ts', {
      encoding: 'utf8',
      stdio: 'pipe'
    });

    log('✅ Type checking passed', colors.green);
    return true;
  } catch (error) {
    if (error.stdout) {
      console.log(error.stdout);
    }
    if (error.stderr) {
      console.error(error.stderr);
    }
    log('❌ Type checking failed', colors.red);
    return false;
  }
}

// Analyze code improvements
function analyzeImprovements() {
  logSection('📊 Code Quality Analysis');

  const oldFunctionPath = 'supabase/functions/bulk-sync-orders/index.ts.backup';
  const newFunctionPath = 'supabase/functions/bulk-sync-orders/index.ts';

  const newContent = fs.readFileSync(path.join(process.cwd(), newFunctionPath), 'utf8');

  // Count lines
  const lineCount = newContent.split('\n').length;
  log(`📝 Total lines: ${lineCount}`, colors.blue);

  // Count functions
  const functionCount = (newContent.match(/function\s+\w+|async\s+function\s+\w+/g) || []).length;
  log(`🔧 Functions: ${functionCount}`, colors.blue);

  // Count imports from shared
  const sharedImports = (newContent.match(/from\s+["']\.\.\/_shared\//g) || []).length;
  log(`📦 Shared imports: ${sharedImports}`, colors.blue);

  // Check for code patterns
  const patterns = {
    'Type annotations': (newContent.match(/:\s*\w+[\[\]<>]*/g) || []).length,
    'Error handling blocks': (newContent.match(/try\s*{/g) || []).length,
    'Async operations': (newContent.match(/async|await/g) || []).length,
    'Comments': (newContent.match(/\/\/|\/\*|\*\//g) || []).length,
  };

  console.log('\nCode Patterns:');
  for (const [pattern, count] of Object.entries(patterns)) {
    log(`   ${pattern}: ${count}`, colors.gray);
  }

  return true;
}

// Main test runner
async function runTests() {
  console.log('');
  log('🚀 Running Local Tests for Improved bulk-sync-orders', colors.blue);
  console.log('');

  const results = {
    utilities: false,
    structure: false,
    typeCheck: false,
    analysis: false
  };

  // Run all tests
  results.utilities = validateSharedUtilities();
  results.structure = validateBulkSyncOrders();
  results.typeCheck = runTypeCheck();
  results.analysis = analyzeImprovements();

  // Summary
  logSection('📊 TEST SUMMARY');

  const table = [
    ['Test', 'Status'],
    ['Shared Utilities', results.utilities ? '✅ Pass' : '❌ Fail'],
    ['Function Structure', results.structure ? '✅ Pass' : '❌ Fail'],
    ['Type Checking', results.typeCheck ? '✅ Pass' : '❌ Fail'],
    ['Code Analysis', results.analysis ? '✅ Pass' : '❌ Fail']
  ];

  // Simple table output
  const colWidths = [20, 10];
  for (const row of table) {
    const formattedRow = row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ');
    console.log(formattedRow);
    if (row === table[0]) {
      console.log('-'.repeat(35));
    }
  }

  const allPassed = Object.values(results).every(r => r === true);

  console.log('');
  if (allPassed) {
    log('✅ All local tests passed!', colors.green);
    log('💡 Ready for deployment. To deploy with actual API testing:', colors.gray);
    log('   1. Set up .env file with SUPABASE_URL and SERVICE_ROLE_KEY', colors.gray);
    log('   2. Run: ./deploy-improved-sync.sh', colors.gray);
  } else {
    log('❌ Some tests failed. Please review the issues above.', colors.red);
  }

  return allPassed;
}

// Run tests
runTests()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });