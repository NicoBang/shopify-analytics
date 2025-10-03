/**
 * Shopify Webhook Handler - Orders
 *
 * Handles webhook events for:
 * - orders/create
 * - orders/updated
 *
 * Features:
 * - HMAC signature verification for security
 * - Stores webhook payloads in order_webhooks table
 * - Minimal processing (logging only, no sync integration yet)
 * - Returns 200 OK to Shopify to acknowledge receipt
 *
 * Environment Variables:
 * - SHOPIFY_WEBHOOK_SECRET: Webhook secret from Shopify app settings
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Supabase service role key
 *
 * Webhook Registration:
 * Register this endpoint in Shopify Admin:
 * Settings → Notifications → Webhooks → Create webhook
 * - Event: Order creation / Order updated
 * - Format: JSON
 * - URL: https://your-domain.vercel.app/api/webhooks/orders
 * - API version: 2024-10
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Verify Shopify webhook HMAC signature
 * @param {string} rawBody - Raw request body as string
 * @param {string} hmacHeader - HMAC header from Shopify (base64)
 * @param {string} secret - Webhook secret from Shopify app
 * @returns {boolean} True if signature is valid
 */
function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!rawBody || !hmacHeader || !secret) {
    console.error('❌ Missing required parameters for HMAC verification');
    return false;
  }

  try {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('base64');

    // Timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(hmacHeader)
    );
  } catch (error) {
    console.error('❌ HMAC verification error:', error.message);
    return false;
  }
}

/**
 * Parse raw body from request
 * Vercel automatically parses JSON, but we need raw body for HMAC
 */
export const config = {
  api: {
    bodyParser: false, // Disable automatic body parsing
  },
};

/**
 * Read raw body from request stream
 */
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Main webhook handler
 */
export default async function handler(req, res) {
  console.log('📥 Webhook request received');

  // 1. Verify HTTP method
  if (req.method !== 'POST') {
    console.warn('⚠️ Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Get Shopify headers
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  const shop = req.headers['x-shopify-shop-domain'];
  const topic = req.headers['x-shopify-topic'];

  if (!hmacHeader) {
    console.error('❌ Missing HMAC header');
    return res.status(401).json({ error: 'Missing HMAC signature' });
  }

  if (!shop || !topic) {
    console.error('❌ Missing required headers:', { shop, topic });
    return res.status(400).json({ error: 'Missing required headers' });
  }

  // 3. Get raw body for HMAC verification
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (error) {
    console.error('❌ Failed to read request body:', error.message);
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // 4. Verify HMAC signature
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('❌ SHOPIFY_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const isValid = verifyShopifyWebhook(rawBody, hmacHeader, webhookSecret);
  if (!isValid) {
    console.error('❌ Invalid HMAC signature from shop:', shop);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  console.log('✅ HMAC signature verified');

  // 5. Parse webhook payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    console.error('❌ Failed to parse JSON payload:', error.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // 6. Extract order information
  const orderId = payload.id?.toString() || 'unknown';
  const orderName = payload.name || 'unknown';

  console.log(`📦 Processing webhook: ${topic} - Order ${orderName} (${orderId}) from ${shop}`);

  // 7. Save webhook to database
  try {
    const { data, error } = await supabase
      .from('order_webhooks')
      .insert({
        shop,
        event_type: topic,
        order_id: orderId,
        payload,
        created_at: new Date().toISOString(),
        processed: false
      })
      .select();

    if (error) {
      console.error('❌ Supabase insert error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return res.status(500).json({
        error: 'Database insert failed',
        details: error.message
      });
    }

    console.log('✅ Webhook saved to database:', {
      id: data[0]?.id,
      shop,
      event_type: topic,
      order_id: orderId
    });

  } catch (error) {
    console.error('❌ Unexpected error during database insert:', {
      message: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }

  // 8. Log successful processing
  console.log(`✅ Webhook processed successfully: ${topic} - Order ${orderName} (${orderId})`);

  // 9. Return 200 OK to Shopify
  return res.status(200).json({
    received: true,
    order_id: orderId,
    event_type: topic
  });
}
