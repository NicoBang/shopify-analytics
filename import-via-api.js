// Import metadata via API endpoint
const fs = require('fs');

const API_BASE = 'https://shopify-analytics-1iczubfpd-nicolais-projects-291e9559.vercel.app/api';
const API_KEY = 'bda5da3d49fe0e7391fded3895b5c6bc';
const CSV_FILE = '/Users/nicolaibang/Downloads/2025 PdL Analytics - _PRODUCT_METADATA.csv';

async function importMetadataViaAPI() {
  console.log('🚀 Starting metadata import via API...');

  try {
    // Read CSV file
    const csvContent = fs.readFileSync(CSV_FILE, 'utf-8');
    const lines = csvContent.split('\n');

    console.log(`📊 Found ${lines.length - 1} lines to process`);

    // Import ALL metadata from CSV
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

      // Log sample for verification (every 1000th item or special ones)
      if (i % 1000 === 0 || ['100515', '100539', '100536'].includes(artikelnummer)) {
        console.log(`📦 Added: ${artikelnummer} - Season: ${metadataItem.season}, Gender: ${metadataItem.gender}, Status: ${metadataItem.status}, Cost: ${metadataItem.kostpris}`);
      }
    }

    console.log(`📋 Parsed ${metadata.length} total metadata items`);

    if (metadata.length === 0) {
      console.log('⚠️ No metadata found');
      return;
    }

    // Upload via API
    const response = await fetch(`${API_BASE}/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        type: 'update',
        metadata: metadata
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ API Response:', result);

    // Test the style analytics now
    console.log('\n🔍 Testing style analytics with new metadata...');
    const testResponse = await fetch(`${API_BASE}/metadata?type=style&startDate=2025-09-15&endDate=2025-09-18`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    if (testResponse.ok) {
      const testResult = await testResponse.json();
      if (testResult.data && testResult.data.length > 0) {
        console.log('📊 Sample results after import:');
        testResult.data.slice(0, 3).forEach(item => {
          console.log(`  ${item.artikelnummer}: Season=${item.season}, Gender=${item.gender}, Status=${item.status}, Cost=${item.kostpris}`);
        });
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
  importMetadataViaAPI().catch(console.error);
}

module.exports = { importMetadataViaAPI };