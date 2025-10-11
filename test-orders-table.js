// Quick test to check orders table structure
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.nicos' });

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://ihawjrtfwysyokfotewn.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloYXdqcnRmd3lzeW9rZm90ZXduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODA0OTMyOCwiZXhwIjoyMDczNjI1MzI4fQ.MzRIK7zmo-O8yt89vxYsw9DVMLyHLo7OUSLSnXaOUJM'
);

async function checkSchema() {
  // Get a sample order
  const { data: sample, error } = await supabase
    .from('orders')
    .select('*')
    .eq('shop', 'pompdelux-da.myshopify.com')
    .limit(1);

  if (error) {
    console.error('Error:', error);
  } else if (sample && sample.length > 0) {
    console.log('Sample order columns:', Object.keys(sample[0]));
    console.log('\nSample order:', JSON.stringify(sample[0], null, 2));
  } else {
    console.log('No orders found');
  }
}

checkSchema();