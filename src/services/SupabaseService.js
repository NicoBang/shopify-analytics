// src/services/SupabaseService.js
const { createClient } = require('@supabase/supabase-js');

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

  // Test connection to Supabase
  async testConnection() {
    try {
      const { data, error } = await this.supabase
        .from('sync_log')
        .select('count')
        .limit(1);

      if (error) throw error;
      return { success: true, message: 'Supabase connection successful' };
    } catch (error) {
      throw new Error(`Supabase connection failed: ${error.message}`);
    }
  }

  // Insert/update orders
  async upsertOrders(orders) {
    if (!orders || orders.length === 0) return { count: 0 };

    console.log(`📝 Upserting ${orders.length} orders to Supabase...`);

    // Transform orders to match database schema
    const dbOrders = orders.map(order => ({
      shop: order.shop || 'unknown',
      order_id: order.orderId.replace('gid://shopify/Order/', ''),
      created_at: order.createdAt,
      country: order.country,
      discounted_total: order.discountedTotal,
      tax: order.tax,
      shipping: order.shipping,
      item_count: order.itemCount,
      refunded_amount: order.refundedAmount || 0,
      refunded_qty: order.refundedQty || 0,
      refund_date: order.refundDate || null,
      total_discounts_ex_tax: order.totalDiscountsExTax || 0,
      cancelled_qty: order.cancelledQty || 0,
      sale_discount_total: order.saleDiscountTotal || 0,
      combined_discount_total: order.combinedDiscountTotal || 0,
      raw_data: order,
      updated_at: new Date().toISOString()
    }));

    const { data, error } = await this.supabase
      .from('orders')
      .upsert(dbOrders, {
        onConflict: 'shop,order_id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error upserting orders:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${orders.length} orders`);
    return { count: orders.length, data };
  }

  // Insert/update SKUs
  async upsertSkus(skus) {
    if (!skus || skus.length === 0) return { count: 0 };

    console.log(`📝 Upserting ${skus.length} SKUs to Supabase...`);

    const { data, error } = await this.supabase
      .from('skus')
      .upsert(skus, {
        onConflict: 'shop,order_id,sku',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error upserting SKUs:', error);
      throw error;
    }

    console.log(`✅ Successfully upserted ${skus.length} SKUs`);
    return { count: skus.length, data };
  }

  // Update inventory
  async updateInventory(inventory) {
    if (!inventory || inventory.length === 0) return { count: 0 };

    console.log(`📦 Updating ${inventory.length} inventory items...`);

    const dbInventory = inventory.map(item => ({
      sku: item.sku,
      quantity: item.quantity,
      last_updated: new Date().toISOString()
    }));

    const { data, error } = await this.supabase
      .from('inventory')
      .upsert(dbInventory, {
        onConflict: 'sku',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error updating inventory:', error);
      throw error;
    }

    console.log(`✅ Successfully updated ${inventory.length} inventory items`);
    return { count: inventory.length, data };
  }

  // Get orders for a specific period
  async getOrdersForPeriod(startDate, endDate, shop = null) {
    let query = this.supabase
      .from('orders')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false });

    if (shop) {
      query = query.eq('shop', shop);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching orders:', error);
      throw error;
    }

    return data || [];
  }

  // Get analytics data
  async getAnalytics(startDate, endDate) {
    const { data, error } = await this.supabase
      .from('order_analytics')
      .select('*')
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) {
      console.error('❌ Error fetching analytics:', error);
      throw error;
    }

    return data || [];
  }

  // Log sync operations
  async logSync(shop, syncType, recordsSynced, errorMessage = null) {
    const logEntry = {
      shop,
      sync_type: syncType,
      records_synced: recordsSynced,
      completed_at: new Date().toISOString(),
      status: errorMessage ? 'failed' : 'completed',
      error_message: errorMessage
    };

    const { error } = await this.supabase
      .from('sync_log')
      .insert([logEntry]);

    if (error) {
      console.error('⚠️ Error logging sync:', error);
      // Don't throw - logging should not break the main process
    } else {
      console.log(`📊 Logged sync: ${shop} ${syncType} - ${recordsSynced} records`);
    }
  }

  // Get recent sync logs
  async getSyncLogs(shop = null, limit = 50) {
    let query = this.supabase
      .from('sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (shop) {
      query = query.eq('shop', shop);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Error fetching sync logs:', error);
      throw error;
    }

    return data || [];
  }

  // Clean old sync logs (call this periodically)
  async cleanOldSyncLogs() {
    const { error } = await this.supabase
      .rpc('clean_old_sync_logs');

    if (error) {
      console.error('❌ Error cleaning old sync logs:', error);
      throw error;
    }

    console.log('🧹 Cleaned old sync logs');
  }
}

module.exports = SupabaseService;