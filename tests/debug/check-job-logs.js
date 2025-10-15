const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://ihawjrtfwysyokfotewn.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLogs() {
  const { data, error } = await supabase
    .from('bulk_sync_jobs')
    .select('*')
    .eq('object_type', 'skus')
    .eq('start_date', '2025-10-11')
    .eq('end_date', '2025-10-11')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`✅ Found ${data.length} SKU job logs for 2025-10-11\n`);
  
  data.forEach(job => {
    console.log(`Shop: ${job.shop}`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Records: ${job.records_processed || 0}`);
    console.log(`  Started: ${job.started_at}`);
    console.log(`  Completed: ${job.completed_at || 'N/A'}`);
    console.log('');
  });
}

checkLogs();
