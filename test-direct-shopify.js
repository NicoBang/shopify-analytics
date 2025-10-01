// Test script to call Shopify GraphQL directly and see what metafields we get

const SHOPIFY_TOKEN = 'process.env.SHOPIFY_ACCESS_TOKEN';
const SHOP_DOMAIN = 'pompdelux-da.myshopify.com';

async function testShopifyMetafields() {
  console.log('🔍 Testing Shopify GraphQL metafields response...\n');

  const query = `
    query {
      productVariants(first: 3) {
        edges {
          node {
            sku
            price
            compareAtPrice
            product {
              title
              status
              tags
              metafields(first: 20, namespace: "custom") {
                edges {
                  node {
                    key
                    value
                    namespace
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
                  namespace
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(`https://${SHOP_DOMAIN}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    });

    const result = await response.json();

    if (result.errors) {
      console.error('❌ GraphQL errors:', JSON.stringify(result.errors, null, 2));
      return;
    }

    console.log('✅ Successfully fetched data from Shopify\n');

    result.data.productVariants.edges.forEach((edge, idx) => {
      const variant = edge.node;
      console.log(`\n======= PRODUCT ${idx + 1} =======`);
      console.log(`SKU: ${variant.sku}`);
      console.log(`Product Title: ${variant.product.title}`);
      console.log(`Variant Title: ${variant.title}`);
      console.log(`Status: ${variant.product.status}`);
      console.log(`Price: ${variant.price}`);
      console.log(`Cost: ${variant.inventoryItem?.unitCost?.amount || 'N/A'}`);

      console.log(`\n📦 PRODUCT METAFIELDS (${variant.product.metafields.edges.length}):`);
      if (variant.product.metafields.edges.length === 0) {
        console.log('  (no metafields found)');
      } else {
        variant.product.metafields.edges.forEach(({ node }) => {
          console.log(`  ${node.namespace}.${node.key} = ${node.value}`);
        });
      }

      console.log(`\n📦 VARIANT METAFIELDS (${variant.metafields.edges.length}):`);
      if (variant.metafields.edges.length === 0) {
        console.log('  (no metafields found)');
      } else {
        variant.metafields.edges.forEach(({ node }) => {
          console.log(`  ${node.namespace}.${node.key} = ${node.value}`);
        });
      }

      // Simulate the metadata combining logic
      const metadata = {};
      variant.product.metafields.edges.forEach(({ node }) => {
        metadata[node.key] = node.value;
      });
      variant.metafields.edges.forEach(({ node }) => {
        metadata[node.key] = node.value;
      });

      console.log(`\n🔍 COMBINED METADATA:`);
      console.log(`  metadata.program = "${metadata.program || 'MISSING'}"`);
      console.log(`  metadata.season = "${metadata.season || 'MISSING'}"`);
      console.log(`  metadata.gender = "${metadata.gender || 'MISSING'}"`);
      console.log(`  metadata.produkt = "${metadata.produkt || 'MISSING'}"`);
      console.log(`  metadata.farve = "${metadata.farve || 'MISSING'}"`);
      console.log(`  All keys: ${Object.keys(metadata).join(', ') || 'NONE'}`);
    });

    console.log('\n\n✅ Test complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testShopifyMetafields();