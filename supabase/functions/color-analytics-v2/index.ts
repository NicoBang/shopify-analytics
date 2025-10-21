// color-analytics-v2 Edge Function - Fast Color Analytics using pre-aggregated daily_color_metrics
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

  async getColorAnalytics(startDate: Date, endDate: Date, shop: string | null = null) {
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

    console.log(`⚡ Fetching Color Analytics: ${dateStart} to ${dateEnd}`);

    // Step 1: Fetch ALL SKUs from product_metadata (with pagination to bypass 1000 row limit)
    const allSkus: any[] = [];
    let skuOffset = 0;
    const skuBatchSize = 1000;
    let hasMoreSkus = true;

    while (hasMoreSkus) {
      const { data: skuBatch, error: skuError } = await this.supabase
        .from('product_metadata')
        .select('sku, program, season, gender, status, cost, varemodtaget, tags, price, compare_at_price, product_title')
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

    // Extract unique artikelnumre and SUM varemodtaget across all SKUs
    const artikelSet = new Map();
    allSkus.forEach((row: any) => {
      const match = row.sku?.match(/^(\d+)/);
      if (match) {
        const artikelnummer = match[1];
        if (!artikelSet.has(artikelnummer)) {
          // First occurrence - initialize with all fields
          artikelSet.set(artikelnummer, {
            ...row,
            varemodtaget: row.varemodtaget || 0
          });
        } else {
          // Subsequent occurrence - sum varemodtaget
          const existing = artikelSet.get(artikelnummer);
          existing.varemodtaget += row.varemodtaget || 0;
        }
      }
    });
    const allArtikler = Array.from(artikelSet.values());
    console.log(`  Total unique artikelnumre from metadata: ${allArtikler.length}`);


    // Step 2: Query pre-aggregated color metrics for the period with PAGINATION
    const allMetrics: any[] = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = this.supabase
        .from('daily_color_metrics')
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
        console.error('❌ Error fetching color metrics:', error);
        throw error;
      }

      if (batch && batch.length > 0) {
        allMetrics.push(...batch);
        hasMore = batch.length === batchSize;
        offset += batchSize;
        if (hasMore) {
          console.log(`  Fetched ${offset} color metrics, continuing...`);
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`  Total color metrics fetched for period: ${allMetrics.length}`);

    // Step 3: Fetch inventory with PAGINATION (inventory table has >1000 rows)
    const allInventory: any[] = [];
    let invOffset = 0;
    const invBatchSize = 1000;
    let hasMoreInventory = true;

    while (hasMoreInventory) {
      const { data: invBatch, error: inventoryError } = await this.supabase
        .from('inventory')
        .select('sku, quantity')
        .order('sku', { ascending: true })
        .range(invOffset, invOffset + invBatchSize - 1);

      if (inventoryError) {
        console.error('❌ Error fetching inventory:', inventoryError);
        throw inventoryError;
      }

      if (invBatch && invBatch.length > 0) {
        allInventory.push(...invBatch);
        hasMoreInventory = invBatch.length === invBatchSize;
        invOffset += invBatchSize;
        if (hasMoreInventory) {
          console.log(`  Fetched ${invOffset} inventory rows, continuing...`);
        }
      } else {
        hasMoreInventory = false;
      }
    }

    console.log(`  Total inventory rows fetched: ${allInventory.length}`);

    // Helper function to extract artikelnummer
    function extractArtikelnummer(sku: string): string {
      const match = sku.match(/^(\d+)/);
      return match ? match[1] : '';
    }

    // Aggregate inventory per artikelnummer
    const inventoryMap: Record<string, number> = {};
    allInventory.forEach((inv: any) => {
      const artikelnummer = extractArtikelnummer(inv.sku);
      if (artikelnummer) {
        inventoryMap[artikelnummer] = (inventoryMap[artikelnummer] || 0) + (parseInt(inv.quantity) || 0);
      }
    });

    console.log(`  Inventory aggregated for ${Object.keys(inventoryMap).length} artikelnummer`);

    // Step 4: Build a lookup map of metrics per artikelnummer
    const metricsMap: Record<string, any[]> = {};
    allMetrics.forEach((row: any) => {
      const artikelnummer = row.artikelnummer;
      if (!metricsMap[artikelnummer]) {
        metricsMap[artikelnummer] = [];
      }
      metricsMap[artikelnummer].push(row);
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

    // Step 4: Aggregate metrics per artikelnummer - iterate through ALL unique artikelnumre
    const artikelMap: Record<string, any> = {};

    allArtikler.forEach((metaRow: any) => {
      const match = metaRow.sku?.match(/^(\d+)/);
      if (!match) return;

      const artikelnummer = match[1];
      const { produkt, farve } = parseProductTitle(metaRow.product_title);

      // Initialize artikelnummer with metadata
      artikelMap[artikelnummer] = {
        program: metaRow.program || '',
        produkt: produkt,
        farve: farve,
        artikelnummer: artikelnummer,
        season: metaRow.season || '',
        gender: parseGender(metaRow.gender),
        beregnetKøbt: 0,
        solgt: 0,
        retur: 0,
        lager: 0,
        varemodtaget: metaRow.varemodtaget || 0,
        difference: 0,
        solgtPctAfKøbt: 0,
        returPctAfSolgt: 0,
        kostpris: 0,
        db: 0,
        omsætning: 0,
        status: metaRow.status || '',
        tags: metaRow.tags || '',
        vejlPris: Math.max(parseFloat(metaRow.price) || 0, parseFloat(metaRow.compare_at_price) || 0)
      };

      // Sum metrics from daily_color_metrics for this period (if any)
      const metrics = metricsMap[artikelnummer] || [];
      let totalCancelled = 0;
      let totalRefunded = 0;
      metrics.forEach((row: any) => {
        const m = artikelMap[artikelnummer];
        m.solgt += row.solgt || 0;
        m.retur += row.retur || 0;
        // Sum omsaetning_net (which is revenue_gross - order_discounts)
        m.omsætning += parseFloat(row.omsaetning_net) || 0;
        // Kostpris is ALREADY total cost (not per-unit), just sum it
        m.kostpris += parseFloat(row.kostpris) || 0;
        // Track cancelled and refunded amounts separately
        totalCancelled += parseFloat(row.cancelled_amount) || 0;
        totalRefunded += parseFloat(row.refunded_amount) || 0;
      });

      // ✅ FIX: Subtract cancelled and refunded amounts from omsætning
      artikelMap[artikelnummer].omsætning -= (totalCancelled + totalRefunded);

      // Set inventory from aggregated inventoryMap (not from daily_color_metrics)
      artikelMap[artikelnummer].lager = inventoryMap[artikelnummer] || 0;
    });

    // Calculate derived metrics and format for Google Sheets
    const result = Object.values(artikelMap).map((artikel: any) => {
      const beregnetKøbt = (artikel.solgt + artikel.lager) - artikel.retur;
      const solgtPct = beregnetKøbt > 0 ? (artikel.solgt / beregnetKøbt) : 0;
      const returPct = artikel.solgt > 0 ? (artikel.retur / artikel.solgt) : 0;
      // kostpris from database is ALREADY total cost (unit_cost × solgt calculated in migration)
      const db = artikel.omsætning - artikel.kostpris;
      const dbPct = artikel.omsætning > 0 ? (db / artikel.omsætning) : 0;
      const difference = artikel.varemodtaget - beregnetKøbt;

      // Return 20 columns matching old Color_Analytics format:
      // Program, Produkt, Farve, Artikelnummer, Sæson, Køn, Beregnet købt, Solgt, Retur,
      // Lager, Varemodtaget, Difference, Solgt % af købt, Retur % af solgt, Kostpris,
      // DB, Omsætning kr, Status, Tags, Vejl. Pris
      return [
        artikel.program,
        artikel.produkt,
        artikel.farve,
        String(artikel.artikelnummer), // Force string to prevent currency formatting
        artikel.season,
        artikel.gender,
        beregnetKøbt,
        artikel.solgt,
        artikel.retur,
        artikel.lager,
        artikel.varemodtaget,
        difference,
        Math.round(solgtPct * 10000) / 100, // 2 decimals as percentage
        Math.round(returPct * 10000) / 100,
        Math.round(artikel.kostpris * 100) / 100, // Total cost (already calculated in DB)
        Math.round(dbPct * 10000) / 100,
        Math.round(artikel.omsætning * 100) / 100,
        artikel.status,
        artikel.tags,
        artikel.vejlPris
      ];
    });

    // Sort by revenue (descending) - column index 16 (Omsætning kr)
    result.sort((a, b) => (b[16] as number) - (a[16] as number));

    console.log(`✅ Color Analytics: ${result.length} colors`);
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
    const type = url.searchParams.get('type') || 'color-analytics';

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

    console.log(`📊 color-analytics-v2 request: ${type}, ${startDateStr} to ${endDateStr}, shop: ${shop || 'all'}`);

    const service = new SupabaseService();
    let data: any;

    if (type === "color-analytics") {
      data = await service.getColorAnalytics(start, end, shop);
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
    console.error('❌ Error in color-analytics-v2:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
