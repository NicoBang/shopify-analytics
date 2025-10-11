// Shared TypeScript interfaces and types

export interface ShopifyOrder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  subtotalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  totalDiscountsSet: {
    shopMoney: {
      amount: string;
    };
  };
  totalPriceSet: {
    shopMoney: {
      amount: string;
    };
  };
  totalTaxSet: {
    shopMoney: {
      amount: string;
    };
  };
  totalShippingPriceSet: {
    shopMoney: {
      amount: string;
    };
  };
  // Customer and billingAddress removed - causes ACCESS_DENIED in bulk operations
  // customer: {
  //   email: string | null;
  // } | null;
  // billingAddress: {
  //   country: string | null;
  //   city: string | null;
  //   province: string | null;
  // } | null;
  lineItems: {
    edges: Array<{
      node: ShopifyLineItem;
    }>;
  };
}

export interface ShopifyLineItem {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  variant: {
    id: string;
    sku: string | null;
    compareAtPrice: string | null;
  } | null;
  originalUnitPriceSet: {
    shopMoney: {
      amount: string;
    };
  };
  discountedUnitPriceSet: {
    shopMoney: {
      amount: string;
    };
  };
  discountAllocations: Array<{
    allocatedAmountSet: {
      shopMoney: {
        amount: string;
      };
    };
  }>;
}

export interface ShopifyBulkOperation {
  id: string;
  status: string;
  errorCode?: string;
  url?: string;
  objectCount?: number;
  fileSize?: number;
}

export interface OrderRecord {
  shop: string;
  order_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  subtotal_dkk: number;
  total_discount_dkk: number;
  total_dkk: number;
  tax: number;
  shipping_dkk: number;
  country: string | null;
  city: string | null;
  province: string | null;
  customer_email: string | null;
}

export interface BulkSyncJob {
  id?: string;
  shop: string;
  object_type: 'orders' | 'skus' | 'refunds';
  start_date: string;
  end_date?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  records_processed?: number;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

export interface BulkOperationResult {
  success: boolean;
  message: string;
  recordsProcessed?: number;
  errors?: string[];
}