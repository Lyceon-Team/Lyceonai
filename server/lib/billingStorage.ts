import { supabaseServer } from '../../apps/api/src/lib/supabase-server';

export class BillingStorage {
  async getProduct(productId: string) {
    const { data, error } = await supabaseServer
      .rpc('query_stripe_products', { product_id: productId });
    
    if (error) {
      const result = await supabaseServer
        .schema('stripe' as any)
        .from('products')
        .select('*')
        .eq('id', productId)
        .maybeSingle();
      return result.data;
    }
    return data?.[0] || null;
  }

  async listProducts(active = true, limit = 20, offset = 0) {
    const { data, error } = await supabaseServer
      .schema('stripe' as any)
      .from('products')
      .select('*')
      .eq('active', active)
      .range(offset, offset + limit - 1);
    
    if (error) {
      console.error('Error listing products:', error);
      return [];
    }
    return data || [];
  }

  async getPrice(priceId: string) {
    const { data, error } = await supabaseServer
      .schema('stripe' as any)
      .from('prices')
      .select('*')
      .eq('id', priceId)
      .maybeSingle();
    
    if (error) {
      console.error('Error getting price:', error);
      return null;
    }
    return data;
  }

  async listPrices(active = true, limit = 20, offset = 0) {
    const { data, error } = await supabaseServer
      .schema('stripe' as any)
      .from('prices')
      .select('*')
      .eq('active', active)
      .range(offset, offset + limit - 1);
    
    if (error) {
      console.error('Error listing prices:', error);
      return [];
    }
    return data || [];
  }

  async getPricesForProduct(productId: string) {
    const { data, error } = await supabaseServer
      .schema('stripe' as any)
      .from('prices')
      .select('*')
      .eq('product', productId)
      .eq('active', true);
    
    if (error) {
      console.error('Error getting prices for product:', error);
      return [];
    }
    return data || [];
  }

  async getSubscription(subscriptionId: string) {
    const { data, error } = await supabaseServer
      .schema('stripe' as any)
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .maybeSingle();
    
    if (error) {
      console.error('Error getting subscription:', error);
      return null;
    }
    return data;
  }

  async getCustomerSubscriptions(customerId: string) {
    const { data, error } = await supabaseServer
      .schema('stripe' as any)
      .from('subscriptions')
      .select('*')
      .eq('customer', customerId)
      .order('created', { ascending: false });
    
    if (error) {
      console.error('Error getting customer subscriptions:', error);
      return [];
    }
    return data || [];
  }

  async getProfile(userId: string) {
    const { data, error } = await supabaseServer
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    
    if (error) {
      console.error('Error getting profile:', error);
      return null;
    }
    return data;
  }

  async updateProfileStripeInfo(userId: string, stripeInfo: {
    stripe_customer_id?: string;
  }) {
    const { data, error } = await supabaseServer
      .from('profiles')
      .update(stripeInfo)
      .eq('id', userId)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating profile stripe info:', error);
      throw error;
    }
    return data;
  }
}

export const billingStorage = new BillingStorage();
