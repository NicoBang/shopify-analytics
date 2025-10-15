#!/usr/bin/env node

/**
 * Import SKU data from Google Sheets to verification table
 *
 * Usage:
 *   node import-from-sheets.js <SHEET_URL> <RANGE>
 *
 * Example:
 *   node import-from-sheets.js "https://docs.google.com/spreadsheets/d/ABC123/edit" "Sheet1!A1:E1000"
 *
 * Sheet columns expected (in order):
 *   shop, order_id, sku, quantity, price_dkk
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ihawjrtfwysyokfotewn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function importFromSheets(sheetUrl, range) {
  // TODO: Implement Google Sheets API integration
  // For now, show manual CSV export instructions

  console.log('📋 Google Sheets Import Guide:');
  console.log('');
  console.log('1. Open your Google Sheet');
  console.log('2. Select the data range');
  console.log('3. File → Download → CSV');
  console.log('4. Run: node import-from-csv.js <path-to-csv>');
  console.log('');
  console.log('Expected CSV columns:');
  console.log('   shop,order_id,sku,quantity,price_dkk');
}

// If called directly
if (require.main === module) {
  const sheetUrl = process.argv[2];
  const range = process.argv[3] || 'Sheet1!A:E';

  if (!sheetUrl) {
    console.error('Usage: node import-from-sheets.js <SHEET_URL> [RANGE]');
    process.exit(1);
  }

  importFromSheets(sheetUrl, range);
}

module.exports = { importFromSheets };
