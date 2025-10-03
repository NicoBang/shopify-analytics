/**
 * Unit Tests: Shopify Webhook Handler - Orders
 *
 * Test Coverage:
 * 1. Happy path: Valid HMAC + successful DB insert
 * 2. Invalid HMAC signature → 401 Unauthorized
 * 3. Missing HMAC header → 401 Unauthorized
 * 4. Wrong HTTP method (GET) → 405 Method Not Allowed
 * 5. orders/create event → correct event_type stored
 * 6. orders/updated event → correct event_type stored
 * 7. Supabase insert error → log error, return 500
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Mock environment variables
process.env.SHOPIFY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test_service_key';

// Mock Supabase client
const mockSupabaseInsert = vi.fn();
const mockSupabaseSelect = vi.fn();
const mockSupabaseFrom = vi.fn(() => ({
  insert: mockSupabaseInsert,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockSupabaseFrom,
  })),
}));

// Helper: Generate valid HMAC signature
function generateValidHMAC(body, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');
}

// Helper: Create mock request
function createMockRequest({ method = 'POST', headers = {}, body = {} }) {
  const bodyString = JSON.stringify(body);
  const chunks = [Buffer.from(bodyString)];

  return {
    method,
    headers,
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

// Helper: Create mock response
function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status: vi.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (data) {
      this.body = data;
      return this;
    }),
  };
  return res;
}

// Mock webhook payloads
const mockOrderCreatePayload = {
  id: 7519885885707,
  name: '#1001',
  created_at: '2024-09-26T10:00:00Z',
  total_price: '1000.00',
  currency: 'DKK',
};

const mockOrderUpdatedPayload = {
  id: 7519885885708,
  name: '#1002',
  created_at: '2024-09-26T11:00:00Z',
  updated_at: '2024-09-26T12:00:00Z',
  total_price: '1500.00',
  currency: 'DKK',
};

describe('Webhook Handler - Orders', () => {
  let handler;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    mockSupabaseInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ id: 1 }],
        error: null,
      }),
    });

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Import handler (fresh import for each test)
    const module = await import('../../api/webhooks/orders.js');
    handler = module.default;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ========================================
  // Test 1: Happy Path - Valid HMAC + Successful DB Insert
  // ========================================
  it('should process valid webhook and insert to database', async () => {
    const shop = 'pompdelux-da.myshopify.com';
    const topic = 'orders/create';
    const bodyString = JSON.stringify(mockOrderCreatePayload);
    const hmac = generateValidHMAC(bodyString, process.env.SHOPIFY_WEBHOOK_SECRET);

    const req = createMockRequest({
      headers: {
        'x-shopify-hmac-sha256': hmac,
        'x-shopify-shop-domain': shop,
        'x-shopify-topic': topic,
      },
      body: mockOrderCreatePayload,
    });

    const res = createMockResponse();

    await handler(req, res);

    // Verify response
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      received: true,
      order_id: '7519885885707',
      event_type: topic,
    });

    // Verify Supabase insert was called
    expect(mockSupabaseFrom).toHaveBeenCalledWith('order_webhooks');
    expect(mockSupabaseInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        shop,
        event_type: topic,
        order_id: '7519885885707',
        payload: mockOrderCreatePayload,
        processed: false,
      })
    );

    // Verify success logging
    expect(consoleLogSpy).toHaveBeenCalledWith('✅ HMAC signature verified');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('✅ Webhook processed successfully')
    );
  });

  // ========================================
  // Test 2: Invalid HMAC Signature
  // ========================================
  it('should reject webhook with invalid HMAC signature', async () => {
    const shop = 'pompdelux-da.myshopify.com';
    const topic = 'orders/create';
    const invalidHmac = 'invalid_hmac_signature_base64';

    const req = createMockRequest({
      headers: {
        'x-shopify-hmac-sha256': invalidHmac,
        'x-shopify-shop-domain': shop,
        'x-shopify-topic': topic,
      },
      body: mockOrderCreatePayload,
    });

    const res = createMockResponse();

    await handler(req, res);

    // Verify 401 Unauthorized
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid signature' });

    // Verify Supabase was NOT called
    expect(mockSupabaseInsert).not.toHaveBeenCalled();

    // Verify error logging
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('❌ Invalid HMAC signature')
    );
  });

  // ========================================
  // Test 3: Missing HMAC Header
  // ========================================
  it('should reject webhook with missing HMAC header', async () => {
    const shop = 'pompdelux-da.myshopify.com';
    const topic = 'orders/create';

    const req = createMockRequest({
      headers: {
        // Missing 'x-shopify-hmac-sha256'
        'x-shopify-shop-domain': shop,
        'x-shopify-topic': topic,
      },
      body: mockOrderCreatePayload,
    });

    const res = createMockResponse();

    await handler(req, res);

    // Verify 401 Unauthorized
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Missing HMAC signature' });

    // Verify Supabase was NOT called
    expect(mockSupabaseInsert).not.toHaveBeenCalled();

    // Verify error logging
    expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Missing HMAC header');
  });

  // ========================================
  // Test 4: Wrong HTTP Method
  // ========================================
  it('should reject non-POST requests with 405', async () => {
    const req = createMockRequest({
      method: 'GET',
      headers: {},
      body: {},
    });

    const res = createMockResponse();

    await handler(req, res);

    // Verify 405 Method Not Allowed
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });

    // Verify Supabase was NOT called
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
  });

  // ========================================
  // Test 5: orders/create Event Type
  // ========================================
  it('should correctly store orders/create event type', async () => {
    const shop = 'pompdelux-da.myshopify.com';
    const topic = 'orders/create';
    const bodyString = JSON.stringify(mockOrderCreatePayload);
    const hmac = generateValidHMAC(bodyString, process.env.SHOPIFY_WEBHOOK_SECRET);

    const req = createMockRequest({
      headers: {
        'x-shopify-hmac-sha256': hmac,
        'x-shopify-shop-domain': shop,
        'x-shopify-topic': topic,
      },
      body: mockOrderCreatePayload,
    });

    const res = createMockResponse();

    await handler(req, res);

    // Verify correct event_type stored
    expect(mockSupabaseInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'orders/create',
      })
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.event_type).toBe('orders/create');
  });

  // ========================================
  // Test 6: orders/updated Event Type
  // ========================================
  it('should correctly store orders/updated event type', async () => {
    const shop = 'pompdelux-de.myshopify.com';
    const topic = 'orders/updated';
    const bodyString = JSON.stringify(mockOrderUpdatedPayload);
    const hmac = generateValidHMAC(bodyString, process.env.SHOPIFY_WEBHOOK_SECRET);

    const req = createMockRequest({
      headers: {
        'x-shopify-hmac-sha256': hmac,
        'x-shopify-shop-domain': shop,
        'x-shopify-topic': topic,
      },
      body: mockOrderUpdatedPayload,
    });

    const res = createMockResponse();

    await handler(req, res);

    // Verify correct event_type stored
    expect(mockSupabaseInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        shop: 'pompdelux-de.myshopify.com',
        event_type: 'orders/updated',
        order_id: '7519885885708',
      })
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.event_type).toBe('orders/updated');
  });

  // ========================================
  // Test 7: Supabase Insert Error Handling
  // ========================================
  it('should handle Supabase insert errors and return 500', async () => {
    const shop = 'pompdelux-nl.myshopify.com';
    const topic = 'orders/create';
    const bodyString = JSON.stringify(mockOrderCreatePayload);
    const hmac = generateValidHMAC(bodyString, process.env.SHOPIFY_WEBHOOK_SECRET);

    // Mock Supabase error
    const supabaseError = {
      message: 'duplicate key value violates unique constraint',
      details: 'Key (id)=(1) already exists',
      hint: 'Check for duplicate entries',
      code: '23505',
    };

    mockSupabaseInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: null,
        error: supabaseError,
      }),
    });

    const req = createMockRequest({
      headers: {
        'x-shopify-hmac-sha256': hmac,
        'x-shopify-shop-domain': shop,
        'x-shopify-topic': topic,
      },
      body: mockOrderCreatePayload,
    });

    const res = createMockResponse();

    await handler(req, res);

    // Verify 500 Internal Server Error
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: 'Database insert failed',
      details: supabaseError.message,
    });

    // Verify error was logged with full details
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '❌ Supabase insert error:',
      expect.objectContaining({
        message: supabaseError.message,
        details: supabaseError.details,
        hint: supabaseError.hint,
        code: supabaseError.code,
      })
    );
  });

  // ========================================
  // Test 8: Missing Required Headers
  // ========================================
  it('should reject webhook with missing shop or topic headers', async () => {
    const bodyString = JSON.stringify(mockOrderCreatePayload);
    const hmac = generateValidHMAC(bodyString, process.env.SHOPIFY_WEBHOOK_SECRET);

    const req = createMockRequest({
      headers: {
        'x-shopify-hmac-sha256': hmac,
        // Missing 'x-shopify-shop-domain' and 'x-shopify-topic'
      },
      body: mockOrderCreatePayload,
    });

    const res = createMockResponse();

    await handler(req, res);

    // Verify 400 Bad Request
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Missing required headers' });

    // Verify Supabase was NOT called
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
  });

  // ========================================
  // Test 9: Invalid JSON Payload
  // ========================================
  it('should reject webhook with invalid JSON payload', async () => {
    const shop = 'pompdelux-int.myshopify.com';
    const topic = 'orders/create';
    const invalidBody = 'not valid json {';
    const hmac = generateValidHMAC(invalidBody, process.env.SHOPIFY_WEBHOOK_SECRET);

    // Create request with invalid JSON
    const chunks = [Buffer.from(invalidBody)];
    const req = {
      method: 'POST',
      headers: {
        'x-shopify-hmac-sha256': hmac,
        'x-shopify-shop-domain': shop,
        'x-shopify-topic': topic,
      },
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      },
    };

    const res = createMockResponse();

    await handler(req, res);

    // Verify 400 Bad Request
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON payload' });

    // Verify Supabase was NOT called
    expect(mockSupabaseInsert).not.toHaveBeenCalled();
  });
});
