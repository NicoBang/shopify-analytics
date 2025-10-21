// Backfill daily_sku_metrics table from skus and product_metadata tables
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

interface SkuMetric {
  metric_date: string;
  sku: string;
  artikelnummer: string;
  program: string | null;
  produkt: string | null;
  farve: string | null;
  stoerrelse: string | null;
  season: string | null;
  gender: string | null;
  solgt: number;
  retur: number;
  cancelled: number;
  omsaetning_net: number;
  refunded_amount: number;
  shops: string | null;
  varemodtaget: number;
  kostpris: number;
  status: string | null;
  tags: string | null;
  vejl_pris: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request parameters
    const { startDate, endDate, batchSize = 100 } = await req.json();

    if (!startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: startDate, endDate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔄 Backfilling daily_sku_metrics from ${startDate} to ${endDate}`);

    // Step 1: Fetch all product metadata (for variant_title, varemodtaget, program, etc.)
    console.log('📦 Fetching product metadata...');
    const { data: metadataRows, error: metadataError } = await supabase
      .from('product_metadata')
      .select('*');

    if (metadataError) {
      throw new Error(`Metadata fetch failed: ${metadataError.message}`);
    }

    const metadataMap = new Map<string, any>();
    metadataRows?.forEach((row: any) => {
      metadataMap.set(row.sku, row);
    });
    console.log(`✅ Loaded ${metadataMap.size} SKU metadata entries`);

    // Step 2: Aggregate SKUs by date and SKU
    console.log('📊 Aggregating SKU data...');
    const { data: skuRows, error: skuError } = await supabase
      .from('skus')
      .select('*')
      .gte('created_at_original', startDate)
      .lte('created_at_original', endDate)
      .order('created_at_original', { ascending: true });

    if (skuError) {
      throw new Error(`SKU fetch failed: ${skuError.message}`);
    }

    if (!skuRows || skuRows.length === 0) {
      console.log('⚠️ No SKU data found for period');
      return new Response(
        JSON.stringify({ success: true, message: 'No data to backfill', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📦 Processing ${skuRows.length} SKU records`);

    // Aggregate by (date, sku)
    const aggregationMap = new Map<string, SkuMetric>();

    skuRows.forEach((row: any) => {
      const date = row.created_at; // DATE field (YYYY-MM-DD)
      const sku = row.sku;
      const key = `${date}|${sku}`;

      if (!aggregationMap.has(key)) {
        // Extract artikelnummer (before \\ or /)
        const artikelnummer = sku.split(/[\\\/]/)[0];

        // Get metadata for this SKU
        const metadata = metadataMap.get(sku) || {};

        aggregationMap.set(key, {
          metric_date: date,
          sku: sku,
          artikelnummer: artikelnummer,
          program: metadata.program || null,
          produkt: metadata.product_title || null,
          farve: metadata.farve || null,
          stoerrelse: metadata.variant_title || null, // Size from metadata
          season: metadata.season || null,
          gender: metadata.gender || null,
          solgt: 0,
          retur: 0,
          cancelled: 0,
          omsaetning_net: 0,
          refunded_amount: 0,
          shops: null,
          varemodtaget: metadata.varemodtaget || 0,
          kostpris: 0,
          status: metadata.status || null,
          tags: metadata.tags || null,
          vejl_pris: parseFloat(metadata.compare_at_price || metadata.price || '0')
        });
      }

      const metric = aggregationMap.get(key)!;

      // Aggregate quantities
      const quantity = row.quantity || 0;
      const refundedQty = row.refunded_qty || 0;
      const cancelledQty = row.cancelled_qty || 0;
      const priceDkk = parseFloat(row.price_dkk || '0');
      const refundedAmountDkk = parseFloat(row.refunded_amount_dkk || '0');
      const totalDiscountDkk = parseFloat(row.total_discount_dkk || '0');
      const saleDiscountTotalDkk = parseFloat(row.sale_discount_total_dkk || '0');

      // Net sold = quantity - refunded - cancelled
      const netSold = quantity - refundedQty - cancelledQty;
      metric.solgt += netSold;
      metric.retur += refundedQty;
      metric.cancelled += cancelledQty;

      // Revenue calculation (price - discounts - refunds)
      const grossRevenue = priceDkk * quantity;
      const totalDiscounts = totalDiscountDkk + saleDiscountTotalDkk;
      const netRevenue = grossRevenue - totalDiscounts - refundedAmountDkk;
      metric.omsaetning_net += netRevenue;
      metric.refunded_amount += refundedAmountDkk;

      // Cost calculation (assume cost per unit is stored in metadata or calculate proportionally)
      // For now, use price as proxy if kostpris not available
      const metadata = metadataMap.get(sku);
      const costPerUnit = metadata?.kostpris || (priceDkk * 0.5); // Fallback: 50% of price
      metric.kostpris += costPerUnit * netSold;
    });

    console.log(`📊 Aggregated ${aggregationMap.size} unique (date, SKU) combinations`);

    // Step 3: Upsert to daily_sku_metrics table in batches
    const metricsArray = Array.from(aggregationMap.values());
    let processed = 0;

    for (let i = 0; i < metricsArray.length; i += batchSize) {
      const batch = metricsArray.slice(i, i + batchSize);

      const { error: upsertError } = await supabase
        .from('daily_sku_metrics')
        .upsert(batch, {
          onConflict: 'metric_date,sku',
          ignoreDuplicates: false
        });

      if (upsertError) {
        console.error(`❌ Batch upsert failed:`, upsertError);
        throw new Error(`Upsert failed: ${upsertError.message}`);
      }

      processed += batch.length;
      console.log(`✅ Processed ${processed}/${metricsArray.length} metrics`);
    }

    console.log(`✅ Backfill complete: ${processed} metrics inserted/updated`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: processed,
        period: `${startDate} to ${endDate}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Backfill error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
