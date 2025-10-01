// Quick test to see what metafields Shopify actually returns

const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOP_DOMAIN = 'pompdelux-da.myshopify.com';

async function testMetafields() {
  const query = `
    query {
      productVariants(first: 3) {
        edges {
          node {
            sku
            product {
              title
              metafields(first: 30, namespace: "custom") {
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
            metafields(first: 30, namespace: "custom") {
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

  console.log('✅ Successfully fetched metadata\n');

  result.data.productVariants.edges.forEach((edge, idx) => {
    const variant = edge.node;
    console.log(`\n=== Product ${idx + 1}: ${variant.product.title} ===`);
    console.log(`SKU: ${variant.sku}`);
    console.log(`Variant Title: ${variant.title}`);

    console.log('\nProduct Metafields:');
    if (variant.product.metafields.edges.length === 0) {
      console.log('  (none)');
    } else {
      variant.product.metafields.edges.forEach(({ node }) => {
        console.log(`  ${node.namespace}.${node.key} = ${node.value}`);
      });
    }

    console.log('\nVariant Metafields:');
    if (variant.metafields.edges.length === 0) {
      console.log('  (none)');
    } else {
      variant.metafields.edges.forEach(({ node }) => {
        console.log(`  ${node.namespace}.${node.key} = ${node.value}`);
      });
    }
  });
}

testMetafields().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});