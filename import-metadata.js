// Import metadata from old system CSV to new Supabase system
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CSV_FILE = '/Users/nicolaibang/Downloads/2025 PdL Analytics - _PRODUCT_METADATA.csv';

async function importMetadata() {
  console.log('🚀 Starting metadata import...');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing Supabase credentials in environment variables');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Read CSV file
    const csvContent = fs.readFileSync(CSV_FILE, 'utf-8');
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',');

    console.log(`📊 Found ${lines.length - 1} lines to process`);
    console.log(`📋 Headers: ${headers.slice(0, 10).join(', ')}...`);

    const metadata = [];

    // Process each line (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Split CSV line (handling quoted strings)
      const values = parseCSVLine(line);
      if (values.length < 19) continue;

      const sku = values[0];
      if (!sku) continue;

      // Extract artikelnummer from SKU (part before backslash)
      const artikelnummer = sku.split('\\')[0];

      // Parse the metadata according to the CSV structure
      const metadataItem = {
        sku: sku,
        artikelnummer: artikelnummer,
        product_title: values[1] || '',
        variant_title: values[2] || '',
        status: values[3] || 'UNKNOWN',
        cost: parseFloat(values[4]) || 0,
        program: values[5] || '',
        produkt: values[6] || '',
        farve: values[7] || '',
        season: values[9] || '',
        gender: values[10] || '',
        størrelse: values[11] || '',
        varemodtaget: parseInt(values[12]) || 0,
        kostpris: parseFloat(values[13]) || 0,
        stamvarenummer: values[14] || '',
        tags: values[16] || '',
        price: parseFloat(values[17]) || 0,
        compare_at_price: parseFloat(values[18]) || 0,
        last_updated: new Date().toISOString()
      };

      metadata.push(metadataItem);

      // Log sample for verification
      if (i <= 5 || artikelnummer === '100515' || artikelnummer === '100539') {
        console.log(`📦 Sample: ${artikelnummer} - Season: ${metadataItem.season}, Gender: ${metadataItem.gender}, Status: ${metadataItem.status}, Cost: ${metadataItem.kostpris}`);
      }
    }

    console.log(`📋 Parsed ${metadata.length} metadata items`);

    // Upload in batches to Supabase
    const batchSize = 100;
    let imported = 0;

    for (let i = 0; i < metadata.length; i += batchSize) {
      const batch = metadata.slice(i, i + batchSize);

      const { data, error } = await supabase
        .from('product_metadata')
        .upsert(batch, {
          onConflict: 'sku',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`❌ Error uploading batch ${Math.floor(i/batchSize) + 1}:`, error);
        continue;
      }

      imported += batch.length;
      console.log(`✅ Uploaded batch ${Math.floor(i/batchSize) + 1}: ${imported}/${metadata.length} items`);

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`🎉 Successfully imported ${imported} metadata items to Supabase!`);

    // Test query for specific artikelnummer
    console.log('\n🔍 Testing queries for key artikelnummer...');
    const testArtikelnummer = ['100515', '100539', '100536'];

    for (const artikel of testArtikelnummer) {
      const { data: testData, error: testError } = await supabase
        .from('product_metadata')
        .select('*')
        .like('sku', `${artikel}\\%`)
        .limit(1);

      if (testError) {
        console.error(`❌ Test query error for ${artikel}:`, testError);
      } else if (testData && testData.length > 0) {
        const item = testData[0];
        console.log(`✅ ${artikel}: Season=${item.season}, Gender=${item.gender}, Status=${item.status}, Cost=${item.kostpris}`);
      } else {
        console.log(`⚠️ ${artikel}: No data found`);
      }
    }

  } catch (error) {
    console.error('💥 Import error:', error);
  }
}

// Simple CSV parser that handles quoted strings
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add final value
  values.push(current.trim());

  return values;
}

// Run the import
if (require.main === module) {
  importMetadata().catch(console.error);
}

module.exports = { importMetadata };