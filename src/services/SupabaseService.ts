import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export class SupabaseService {
  async upsertOrders(orders: any[]): Promise<void> {
    const { error } = await supabase
      .from('orders')
      .upsert(orders, { onConflict: 'shop,order_id' });
    
    if (error) throw error;
  }

  async upsertSkus(skus: any[]): Promise<void> {
    const { error } = await supabase
      .from('skus')
      .upsert(skus, { onConflict: 'shop,order_id,sku' });
    
    if (error) throw error;
  }

  async updateInventory(inventory: any[]): Promise<void> {
    const { error } = await supabase
      .from('inventory')
      .upsert(inventory, { onConflict: 'sku' });
    
    if (error) throw error;
  }

  async getOrdersForPeriod(startDate: Date, endDate: Date): Promise<any[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());
    
    if (error) throw error;
    return data || [];
  }

  async logSync(shop: string, syncType: string, recordsSynced: number): Promise<void> {
    await supabase
      .from('sync_log')
      .insert({
        shop,
        sync_type: syncType,
        records_synced: recordsSynced,
        completed_at: new Date().toISOString(),
        status: 'completed'
      });
  }
}