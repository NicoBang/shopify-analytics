// sku-analytics-v2 Edge Function - Fast SKU Analytics using pre-aggregated daily_sku_metrics
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
const API_SECRET_KEY = Deno.env.get('API_SECRET_KEY') || '';

class SupabaseService {
  supabase: any;

  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }

  async getSkuAnalytics(startDate: Date, endDate: Date, shop: string | null = null) {
    // ✅ CORRECT: Google Sheets sends UTC timestamps representing Danish dates
    // Example: Danish 09/09/2025 → Google sends 2025-09-08T22:00:00Z (summer) or 2025-09-08T23:00:00Z (winter)
    // We need to add the offset back to get the correct Danish date
    function isDanishSummerTime(utcTimestamp: Date): boolean {
      const date = new Date(utcTimestamp);
      const year = date.getUTCFullYear();

      const marchLastDay = new Date(Date.UTC(year, 2, 31, 1, 0, 0));
      const marchLastSunday = new Date(marchLastDay);
      marchLastSunday.setUTCDate(31 - marchLastDay.getUTCDay());

      const octoberLastDay = new Date(Date.UTC(year, 9, 31, 1, 0, 0));
      const octoberLastSunday = new Date(octoberLastDay);
      octoberLastSunday.setUTCDate(31 - octoberLastDay.getUTCDay());

      return date >= marchLastSunday && date < octoberLastSunday;
    }

    // Extract Danish calendar date by adding correct offset
    const startOffset = isDanishSummerTime(startDate) ? 2 : 1;
    const endOffset = isDanishSummerTime(endDate) ? 2 : 1;

    const dateStart = new Date(startDate.getTime() + startOffset * 60 * 60 * 1000).toISOString().split('T')[0];
    const dateEnd = new Date(endDate.getTime() + endOffset * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`⚡ Fetching SKU Analytics: ${dateStart} to ${dateEnd}`);

    // Step 1: Fetch ALL unique SKUs from product_metadata (with pagination to bypass 1000 row limit)
    const allSkus: any[] = [];
    let skuOffset = 0;
    const skuBatchSize = 1000;
    let hasMoreSkus = true;

    while (hasMoreSkus) {
      const { data: skuBatch, error: skuError } = await this.supabase
        .from('product_metadata')
        .select('sku, program, season, gender, status, cost, varemodtaget, tags, price, compare_at_price, product_title, variant_title')
        .order('sku', { ascending: true })
        .range(skuOffset, skuOffset + skuBatchSize - 1);

      if (skuError) {
        console.error('❌ Error fetching product metadata:', skuError);
        throw skuError;
      }

      if (skuBatch && skuBatch.length > 0) {
        allSkus.push(...skuBatch);
        hasMoreSkus = skuBatch.length === skuBatchSize;
        skuOffset += skuBatchSize;
        if (hasMoreSkus) {
          console.log(`  Fetched ${skuOffset} SKUs from metadata, continuing...`);
        }
      } else {
        hasMoreSkus = false;
      }
    }

    console.log(`  Total unique SKUs from metadata: ${allSkus.length}`);

    // Step 2: Query pre-aggregated SKU metrics for the period with PAGINATION
    const allMetrics: any[] = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = this.supabase
        .from('daily_sku_metrics')
        .select('*')
        .gte('metric_date', dateStart)
        .lte('metric_date', dateEnd)
        .order('metric_date', { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (shop) {
        query = query.eq('shop', shop);
      }

      const { data: batch, error } = await query;

      if (error) {
        console.error('❌ Error fetching SKU metrics:', error);
        throw error;
      }

      if (batch && batch.length > 0) {
        allMetrics.push(...batch);
        hasMore = batch.length === batchSize;
        offset += batchSize;
        if (hasMore) {
          console.log(`  Fetched ${offset} SKU metrics, continuing...`);
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`  Total SKU metrics fetched for period: ${allMetrics.length}`);

    // Step 3: Build a lookup map of metrics per SKU
    const metricsMap: Record<string, any[]> = {};
    allMetrics.forEach((row: any) => {
      const sku = row.sku;
      if (!metricsMap[sku]) {
        metricsMap[sku] = [];
      }
      metricsMap[sku].push(row);
    });

    // Helper: Convert JSON gender array to Danish display format
    function parseGender(genderStr: string | null): string {
      if (!genderStr) return '';
      try {
        const genderArray = JSON.parse(genderStr);
        if (!Array.isArray(genderArray)) return genderStr;

        // If multiple genders or includes Unisex, return Unisex
        if (genderArray.length > 1 || genderArray.includes('Unisex')) {
          return 'Unisex';
        }

        // Convert single gender to Danish
        const gender = genderArray[0];
        if (gender === 'Girl') return 'Pige';
        if (gender === 'Boy') return 'Dreng';
        if (gender === 'Unisex') return 'Unisex';

        return gender;
      } catch {
        return genderStr;
      }
    }

    // Helper: Parse product title to extract Produkt and Farve
    function parseProductTitle(productTitle: string | null) {
      if (!productTitle) return { produkt: '', farve: '' };

      // Parse produkt: everything before first ' - '
      const produkt = productTitle.split(' - ')[0] || '';

      // Parse farve: everything after last ' - ' (before | if exists)
      const parts = productTitle.includes('|')
        ? productTitle.split('|')[0].split(' - ')
        : productTitle.split(' - ');
      const farve = parts.length > 1 ? parts[parts.length - 1] : '';

      return { produkt, farve };
    }

    // Helper: Extract artikelnummer from SKU
    function extractArtikelnummer(sku: string): string {
      const match = sku.match(/^(\d+)/);
      return match ? match[1] : '';
    }

    // Step 4: Aggregate metrics per SKU - iterate through ALL SKUs from metadata
    const skuMap: Record<string, any> = {};

    (allSkus || []).forEach((metaSku: any) => {
      const sku = metaSku.sku;
      const { produkt, farve } = parseProductTitle(metaSku.product_title);
      const artikelnummer = extractArtikelnummer(sku);

      // Initialize SKU with metadata
      skuMap[sku] = {
        program: metaSku.program || '',
        produkt: produkt,
        farve: farve,
        artikelnummer: artikelnummer,
        season: metaSku.season || '',
        gender: parseGender(metaSku.gender),
        stoerrelse: metaSku.variant_title || '',
        beregnetKøbt: 0,
        solgt: 0,
        retur: 0,
        lager: 0,
        varemodtaget: metaSku.varemodtaget || 0,
        difference: 0,
        solgtPctAfKøbt: 0,
        returPctAfSolgt: 0,
        kostpris: 0,
        db: 0,
        omsætning: 0,
        status: metaSku.status || '',
        tags: metaSku.tags || '',
        vejlPris: Math.max(parseFloat(metaSku.price) || 0, parseFloat(metaSku.compare_at_price) || 0)
      };

      // Sum metrics from daily_sku_metrics for this period (if any)
      const metrics = metricsMap[sku] || [];
      metrics.forEach((row: any) => {
        const m = skuMap[sku];
        m.solgt += row.solgt || 0;
        m.retur += row.retur || 0;
        // ✅ REVERT: Just use omsaetning_net directly - it's already correct in database
        m.omsætning += parseFloat(row.omsaetning_net) || 0;
        // Kostpris from database is per-unit cost, sum it across days
        m.kostpris += parseFloat(row.kostpris) || 0;
        // Lager from inventory table (backfilled into daily_sku_metrics)
        m.lager = parseInt(row.lager) || 0;
      });
    });

    // Calculate derived metrics and format for Google Sheets
    const result = Object.values(skuMap).map((sku: any) => {
      const beregnetKøbt = (sku.solgt + sku.lager) - sku.retur;
      const solgtPct = beregnetKøbt > 0 ? (sku.solgt / beregnetKøbt) : 0;
      const returPct = sku.solgt > 0 ? (sku.retur / sku.solgt) : 0;
      // kostpris from database is ALREADY total cost (unit_cost × solgt calculated in migration)
      const db = sku.omsætning - sku.kostpris;
      const dbPct = sku.omsætning > 0 ? (db / sku.omsætning) : 0;
      const difference = sku.varemodtaget - beregnetKøbt;

      // Return 21 columns (including Størrelse)
      // Program, Produkt, Farve, Artikelnummer, Sæson, Køn, Størrelse, Beregnet købt, Solgt, Retur,
      // Lager, Varemodtaget, Difference, Solgt % af købt, Retur % af solgt, Kostpris,
      // DB, Omsætning kr, Status, Tags, Vejl. Pris
      return [
        sku.program,
        sku.produkt,
        sku.farve,
        String(sku.artikelnummer), // Force string to prevent currency formatting
        sku.season,
        sku.gender,
        sku.stoerrelse,
        beregnetKøbt,
        sku.solgt,
        sku.retur,
        sku.lager,
        sku.varemodtaget,
        difference,
        Math.round(solgtPct * 10000) / 100, // 2 decimals as percentage
        Math.round(returPct * 10000) / 100,
        Math.round(sku.kostpris * 100) / 100, // Total cost (already calculated in DB)
        Math.round(dbPct * 10000) / 100,
        Math.round(sku.omsætning * 100) / 100,
        sku.status,
        sku.tags,
        sku.vejlPris
      ];
    });

    // Sort by revenue (descending) - column index 17 (Omsætning kr)
    result.sort((a, b) => (b[17] as number) - (a[17] as number));

    console.log(`✅ SKU Analytics: ${result.length} SKUs`);
    return result;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify API key
    const authHeader = req.headers.get('Authorization') || '';
    const apiKey = authHeader.replace('Bearer ', '');

    if (apiKey !== API_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse query parameters
    const url = new URL(req.url);
    const startDateStr = url.searchParams.get('startDate');
    const endDateStr = url.searchParams.get('endDate');
    const shop = url.searchParams.get('shop');
    const type = url.searchParams.get('type') || 'sku-analytics';

    if (!startDateStr || !endDateStr) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: startDate, endDate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return new Response(
        JSON.stringify({ error: 'Invalid date format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📊 sku-analytics-v2 request: ${type}, ${startDateStr} to ${endDateStr}, shop: ${shop || 'all'}`);

    const service = new SupabaseService();
    let data: any;

    if (type === "sku-analytics") {
      data = await service.getSkuAnalytics(start, end, shop);
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown type: ${type}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return data in format expected by Google Sheets
    const result = {
      success: true,
      data: data,
      count: data.length,
      timestamp: new Date().toISOString()
    };

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('❌ Error in sku-analytics-v2:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
