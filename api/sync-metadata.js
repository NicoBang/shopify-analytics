// api/sync-metadata.js
const { createClient } = require('@supabase/supabase-js');

// Inline SupabaseService for Vercel
class SupabaseService {
  constructor() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('Supabase URL and Service Key are required in environment variables');
    }

    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }

  async syncMetadata(limit = null) {
    console.log(`🏷️ Starting metadata sync from Shopify${limit ? ` (limit: ${limit})` : ''}...`);

    // Use Danish shop as primary metadata source (matching original system)
    const shopDomain = 'pompdelux-da.myshopify.com';
    const shopifyToken = process.env.SHOPIFY_TOKEN_DA;

    if (!shopifyToken) {
      throw new Error('SHOPIFY_TOKEN_DA environment variable is required');
    }

    const metadata = await this.fetchAllVariantsFromShopify(shopDomain, shopifyToken, limit);

    if (metadata.length === 0) {
      console.log('⚠️ No metadata found');
      return { count: 0, metadata: [] };
    }

    console.log(`📦 Found ${metadata.length} variants with metadata`);

    // Clear existing metadata only if doing full sync (no limit)
    if (!limit) {
      const { error: deleteError } = await this.supabase
        .from('product_metadata')
        .delete()
        .neq('sku', 'NEVER_MATCH'); // Delete all rows

      if (deleteError) {
        console.error('❌ Error clearing existing metadata:', deleteError);
        throw deleteError;
      }

      console.log('🧹 Cleared existing metadata');
    } else {
      console.log('🧪 Test mode - keeping existing metadata');
    }

    // Insert new metadata in batches
    const batchSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < metadata.length; i += batchSize) {
      const batch = metadata.slice(i, i + batchSize);

      const { data, error } = await this.supabase
        .from('product_metadata')
        .upsert(batch, {
          onConflict: 'sku',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`❌ Error inserting batch ${Math.floor(i/batchSize) + 1}:`, error);
        throw error;
      }

      totalInserted += batch.length;
      console.log(`✅ Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(metadata.length/batchSize)} (${totalInserted}/${metadata.length} total)`);
    }

    console.log(`✅ Metadata sync completed: ${totalInserted} records`);
    return { count: totalInserted, metadata: metadata.slice(0, 5) }; // Return sample
  }

  async fetchAllVariantsFromShopify(shopDomain, token, limit = null) {
    const allVariants = [];
    let cursor = null;
    let pageCount = 0;
    const batchSize = limit && limit < 250 ? limit : 250; // Max allowed by Shopify

    const query = (cursorVal) => `
      query {
        productVariants(first: ${batchSize}${cursorVal ? `, after: "${cursorVal}"` : ""}) {
          edges {
            cursor
            node {
              id
              sku
              price
              compareAtPrice
              inventoryQuantity
              product {
                title
                status
                tags
                metafields(first: 20, namespace: "custom") {
                  edges {
                    node {
                      key
                      value
                    }
                  }
                }
              }
              title
              inventoryItem {
                unitCost {
                  amount
                }
              }
              metafields(first: 20, namespace: "custom") {
                edges {
                  node {
                    key
                    value
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;

    try {
      while (true) {
        pageCount++;
        console.log(`🚀 Fetching page ${pageCount}${cursor ? ` with cursor: ${cursor.substring(0, 20)}...` : ' (first page)'}`);

        const response = await fetch(`https://${shopDomain}/admin/api/2024-07/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': token
          },
          body: JSON.stringify({ query: query(cursor) })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.errors) {
          throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
        }

        const data = result.data;

        if (!data || !data.productVariants) {
          console.log(`❌ Missing productVariants in response: ${JSON.stringify(data)}`);
          break;
        }

        const edges = data.productVariants.edges || [];
        console.log(`📦 Page ${pageCount}: ${edges.length} variants`);

        edges.forEach(edge => {
          if (!edge || !edge.node) {
            console.log(`⚠️ Invalid edge on page ${pageCount}`);
            return;
          }

          const variant = edge.node;
          const sku = variant.sku?.trim().toUpperCase();
          if (!sku) return;

          const parsed = this.parseVariantToMetadata(variant);
          allVariants.push(parsed);
        });

        // Check if we've reached the limit
        if (limit && allVariants.length >= limit) {
          console.log(`✅ Reached limit of ${limit} variants`);
          break;
        }

        if (!data.productVariants.pageInfo || !data.productVariants.pageInfo.hasNextPage) break;
        cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

        if (!cursor) {
          console.log(`⚠️ No cursor on page ${pageCount} - stopping`);
          break;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch (error) {
      console.error(`❌ Error fetching variants: ${error.message}`);
      throw error;
    }

    // Trim to exact limit if specified
    if (limit && allVariants.length > limit) {
      return allVariants.slice(0, limit);
    }

    return allVariants;
  }

  parseVariantToMetadata(variant) {
    // Combine product and variant metafields (matching MetadataManager.gs logic)
    const metadata = {};

    // Product metafields
    variant.product.metafields.edges.forEach(({ node }) => {
      metadata[node.key] = node.value;
    });

    // Variant metafields (overrides product if there's overlap)
    variant.metafields.edges.forEach(({ node }) => {
      metadata[node.key] = node.value;
    });

    // Extract cost from inventory item
    const cost = variant.inventoryItem?.unitCost?.amount || 0;

    // Extract price and compareAtPrice
    const price = parseFloat(variant.price) || 0;
    const compareAtPrice = parseFloat(variant.compareAtPrice) || 0;

    // Helper function to truncate strings safely
    const truncate = (str, maxLength) => {
      if (!str) return '';
      return str.length > maxLength ? str.substring(0, maxLength) : str;
    };

    return {
      sku: truncate(variant.sku, 200),
      product_title: truncate(variant.product.title, 1000),
      variant_title: truncate(variant.title, 1000),
      status: truncate(variant.product.status, 50),
      cost: parseFloat(cost),
      program: truncate(metadata.program || this.extractFromTitle(variant.product.title, 'program'), 100),
      produkt: truncate(metadata.produkt || this.extractFromTitle(variant.product.title, 'produkt'), 200),
      farve: truncate(metadata.farve || this.extractFromTitle(variant.title, 'farve'), 100),
      artikelnummer: truncate(metadata.artikelnummer || variant.sku, 100),
      stamvarenummer: truncate(metadata.stamvarenummer || metadata['custom.stamvarenummer'] || '', 100),
      season: truncate(metadata.season || '', 50),
      gender: truncate(metadata.gender || '', 20),
      størrelse: truncate(metadata.størrelse || this.extractFromTitle(variant.title, 'størrelse'), 20),
      varemodtaget: parseInt(metadata.varemodtaget) || 0,
      kostpris: parseFloat(cost),
      tags: truncate((variant.product.tags || []).join(', '), 1000),
      price: price,
      compare_at_price: compareAtPrice
    };
  }

  extractFromTitle(title, field) {
    if (!title) return '';

    const patterns = {
      program: /^([A-Z]+)/,
      produkt: /([A-Z]+\s+[A-Z]+)/,
      farve: /\b(BLACK|WHITE|BLUE|RED|GREEN|YELLOW|PINK|GREY|GRAY|NAVY|BROWN)\b/i,
      størrelse: /\b(XS|S|M|L|XL|XXL|\d+)\b/
    };

    const pattern = patterns[field];
    if (pattern) {
      const match = title.match(pattern);
      return match ? match[1] : '';
    }

    return '';
  }
}

// Enable CORS and verify API key
function validateRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
  }

  return null;
}

module.exports = async function handler(req, res) {
  const validationError = validateRequest(req, res);
  if (validationError) return validationError;

  // Extract query parameters
  const { limit } = req.query;
  const limitNumber = limit ? parseInt(limit) : null;

  console.log(`🏷️ Metadata sync request received${limitNumber ? ` (limit: ${limitNumber})` : ''}`);

  try {
    const supabaseService = new SupabaseService();
    const result = await supabaseService.syncMetadata(limitNumber);

    console.log('✅ Metadata sync completed successfully');

    return res.status(200).json({
      success: true,
      message: `Metadata sync completed${limitNumber ? ` (limited to ${limitNumber})` : ''}`,
      count: result.count,
      sample_data: result.metadata,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Metadata sync error:', error);

    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};