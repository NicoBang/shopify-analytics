// check-duplicates.js - Investigate duplicate records issue
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkDuplicates() {
  console.log('🔍 Investigating duplicate records for Jan 16, 2025...\n');

  // 1. Get total count for Jan 16
  const { count: totalCount } = await supabase
    .from('skus')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', '2025-01-16')
    .lt('created_at', '2025-01-17');

  console.log(`📊 Total COUNT(*) for Jan 16: ${totalCount}`);

  // 2. Get all records and check for duplicates
  const { data: allRecords, error } = await supabase
    .from('skus')
    .select('*')
    .gte('created_at', '2025-01-16')
    .lt('created_at', '2025-01-17')
    .order('shop', { ascending: true })
    .order('order_id', { ascending: true })
    .order('sku', { ascending: true });

  if (error) {
    console.error('Error fetching records:', error);
    return;
  }

  console.log(`📦 Actually fetched records: ${allRecords.length}`);

  // 3. Find duplicates based on shop/order_id/sku
  const seen = new Map();
  const duplicates = [];

  allRecords.forEach(record => {
    const key = `${record.shop}-${record.order_id}-${record.sku}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      duplicates.push({
        key,
        record1: { id: existing.id, refund_date: existing.refund_date, refunded_qty: existing.refunded_qty },
        record2: { id: record.id, refund_date: record.refund_date, refunded_qty: record.refunded_qty }
      });
    } else {
      seen.set(key, record);
    }
  });

  console.log(`\n🔄 Duplicate analysis:`);
  console.log(`   Unique combinations: ${seen.size}`);
  console.log(`   Duplicate records: ${duplicates.length}`);
  console.log(`   Total records: ${allRecords.length}`);

  if (duplicates.length > 0) {
    console.log('\n❌ Sample duplicates found:');
    duplicates.slice(0, 5).forEach(dup => {
      console.log(`\n   Key: ${dup.key}`);
      console.log(`   Record 1: ID=${dup.record1.id}, refund_date=${dup.record1.refund_date}, refunded_qty=${dup.record1.refunded_qty}`);
      console.log(`   Record 2: ID=${dup.record2.id}, refund_date=${dup.record2.refund_date}, refunded_qty=${dup.record2.refunded_qty}`);
    });

    // 4. Get IDs to delete (keep the one with refund info or highest ID)
    const idsToDelete = [];
    duplicates.forEach(dup => {
      // Keep record with refund_date, or if both have it, keep higher ID
      if (dup.record1.refund_date && !dup.record2.refund_date) {
        idsToDelete.push(dup.record2.id);
      } else if (!dup.record1.refund_date && dup.record2.refund_date) {
        idsToDelete.push(dup.record1.id);
      } else if (dup.record1.id < dup.record2.id) {
        idsToDelete.push(dup.record1.id);
      } else {
        idsToDelete.push(dup.record2.id);
      }
    });

    console.log(`\n🗑️ IDs to delete: ${idsToDelete.length}`);
    console.log('   Sample IDs:', idsToDelete.slice(0, 10));

    // 5. Check artikelnummer 20204 specifically
    const artikel20204 = allRecords.filter(r => r.sku && r.sku.startsWith('20204'));
    console.log(`\n📦 Artikelnummer 20204 analysis:`);
    console.log(`   Total records: ${artikel20204.length}`);

    const uniqueOrders20204 = new Set(artikel20204.map(r => r.order_id));
    console.log(`   Unique orders: ${uniqueOrders20204.size}`);

    const totalQty20204 = artikel20204.reduce((sum, r) => sum + (r.quantity || 0), 0);
    const totalRefunded20204 = artikel20204.reduce((sum, r) => sum + (r.refunded_qty || 0), 0);
    console.log(`   Total quantity: ${totalQty20204}`);
    console.log(`   Total refunded: ${totalRefunded20204}`);
    console.log(`   Net sold: ${totalQty20204 - totalRefunded20204}`);

    // Check for duplicates in 20204
    const seen20204 = new Map();
    const dup20204 = [];
    artikel20204.forEach(r => {
      const key = `${r.shop}-${r.order_id}-${r.sku}`;
      if (seen20204.has(key)) {
        dup20204.push({ existing: seen20204.get(key), duplicate: r });
      } else {
        seen20204.set(key, r);
      }
    });

    if (dup20204.length > 0) {
      console.log(`\n   ⚠️ Found ${dup20204.length} duplicates in 20204!`);
      dup20204.forEach(d => {
        console.log(`     Order ${d.existing.order_id}: ID ${d.existing.id} vs ID ${d.duplicate.id}`);
      });
    }
  } else {
    console.log('\n✅ No duplicates found!');
  }

  // 6. Compare with expected values
  console.log('\n📊 Summary:');
  console.log(`   SQL COUNT shows: 726`);
  console.log(`   Table Editor shows: 364`);
  console.log(`   Actually fetched: ${allRecords.length}`);
  console.log(`   Unique combinations: ${seen.size}`);
  console.log(`   Difference: ${allRecords.length - seen.size} duplicates`);

  return { totalCount, fetchedCount: allRecords.length, uniqueCount: seen.size, duplicates: duplicates.length };
}

// Run the check
checkDuplicates().catch(console.error);