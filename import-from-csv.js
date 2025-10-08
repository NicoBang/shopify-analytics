#!/usr/bin/env node

/**
 * Import SKU verification data from CSV file
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=xxx node import-from-csv.js <csv-file>
 *
 * CSV format (with header):
 *   shop,order_id,sku,quantity,price_dkk
 *   pompdelux-da.myshopify.com,7801400230222,100123,4,47.76
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ihawjrtfwysyokfotewn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_KEY environment variable');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const record = {};

    headers.forEach((header, idx) => {
      record[header] = values[idx];
    });

    records.push(record);
  }

  return records;
}

async function importCSV(filePath) {
  console.log(`📂 Reading CSV file: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const records = parseCSV(content);

  console.log(`📊 Found ${records.length} records`);
  console.log(`🔍 Sample record:`, records[0]);

  // Transform to verification table format
  const verificationData = records.map(r => {
    const quantity = parseInt(r.quantity);
    const totalPrice = parseFloat(r.price_dkk);

    // ✅ If price_dkk is total price, divide by quantity to get per-unit price
    const pricePerUnit = quantity > 0 ? totalPrice / quantity : totalPrice;

    return {
      shop: r.shop,
      order_id: r.order_id,
      sku: r.sku,
      quantity: quantity,
      price_dkk: pricePerUnit,  // ✅ Per-unit price EX TAX
      original_price_dkk: parseFloat(r.original_price_dkk || 0),
      total_discount_dkk: parseFloat(r.total_discount_dkk || 0)
    };
  });

  // Filter out invalid records
  const validRecords = verificationData.filter(r =>
    r.shop && r.order_id && r.sku && !isNaN(r.quantity) && !isNaN(r.price_dkk)
  );

  console.log(`✅ Valid records: ${validRecords.length}`);

  if (validRecords.length === 0) {
    console.error('❌ No valid records to import');
    return;
  }

  // Batch insert
  const BATCH_SIZE = 500;
  let totalInserted = 0;

  for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
    const batch = validRecords.slice(i, i + BATCH_SIZE);

    console.log(`💾 Upserting batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} records)...`);

    const { error } = await supabase
      .from('sku_price_verification')
      .upsert(batch, { onConflict: 'shop,order_id,sku' });

    if (error) {
      console.error(`❌ Error upserting batch:`, error);
      throw error;
    }

    totalInserted += batch.length;
    console.log(`   ✅ ${totalInserted} / ${validRecords.length} records upserted`);
  }

  console.log('');
  console.log(`✅ Import complete!`);
  console.log(`   Total records imported: ${totalInserted}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Run: psql -f migrations/merge_verified_sku_prices.sql');
  console.log('2. Verify results');
  console.log('3. Clean up verification table');
}

// If called directly
if (require.main === module) {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: SUPABASE_SERVICE_KEY=xxx node import-from-csv.js <csv-file>');
    console.error('');
    console.error('CSV format (with header):');
    console.error('  shop,order_id,sku,quantity,price_dkk');
    process.exit(1);
  }

  importCSV(filePath).catch(err => {
    console.error('❌ Import failed:', err.message);
    process.exit(1);
  });
}
