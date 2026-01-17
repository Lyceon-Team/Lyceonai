import { getUncachableStripeClient } from '../lib/stripeClient';

interface PriceConfig {
  label: string;
  unit_amount: number;
  interval: 'month' | 'year';
  interval_count: number;
  plan_type: string;
}

const PRICE_CONFIGS: PriceConfig[] = [
  { label: 'Monthly', unit_amount: 9900, interval: 'month', interval_count: 1, plan_type: 'monthly' },
  { label: 'Quarterly', unit_amount: 19900, interval: 'month', interval_count: 3, plan_type: 'quarterly' },
  { label: 'Yearly', unit_amount: 69900, interval: 'year', interval_count: 1, plan_type: 'yearly' },
];

async function seedProducts() {
  console.log('Seeding Stripe products for Lyceon...\n');

  const stripe = await getUncachableStripeClient();

  let productId: string;
  const products = await stripe.products.search({ query: "name:'Parent Access'" });
  
  if (products.data.length > 0) {
    productId = products.data[0].id;
    console.log('Found existing Parent Access product:', productId);
  } else {
    const product = await stripe.products.create({
      name: 'Parent Access',
      description: 'Monitor your child\'s SAT preparation progress. Get weekly summaries, accuracy reports, and insights into areas that need improvement.',
      metadata: {
        plan_id: 'parent_access',
        features: 'weekly_summary,accuracy_reports,weakness_tracking,study_time_insights',
      },
    });
    productId = product.id;
    console.log('Created new Parent Access product:', productId);
  }

  const existingPrices = await stripe.prices.list({ product: productId, active: true });
  console.log('\nExisting active prices:');
  existingPrices.data.forEach(p => {
    console.log(`  - ${p.id}: $${(p.unit_amount || 0) / 100}/${p.recurring?.interval} (interval_count: ${p.recurring?.interval_count})`);
  });

  const finalPrices: Record<string, string> = {};

  for (const config of PRICE_CONFIGS) {
    const existingPrice = existingPrices.data.find(p => 
      p.unit_amount === config.unit_amount && 
      p.recurring?.interval === config.interval &&
      p.recurring?.interval_count === config.interval_count
    );

    if (existingPrice) {
      console.log(`\n${config.label}: Found existing price ${existingPrice.id}`);
      finalPrices[config.plan_type.toUpperCase()] = existingPrice.id;
    } else {
      const newPrice = await stripe.prices.create({
        product: productId,
        unit_amount: config.unit_amount,
        currency: 'usd',
        recurring: { 
          interval: config.interval,
          interval_count: config.interval_count,
        },
        metadata: {
          plan_type: config.plan_type,
        },
      });
      console.log(`\n${config.label}: Created new price ${newPrice.id} ($${config.unit_amount / 100}/${config.interval}${config.interval_count > 1 ? ` x${config.interval_count}` : ''})`);
      finalPrices[config.plan_type.toUpperCase()] = newPrice.id;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('FINAL PRICE IDS (add these to your environment):');
  console.log('='.repeat(50));
  console.log(`STRIPE_PRICE_PARENT_MONTHLY=${finalPrices.MONTHLY}`);
  console.log(`STRIPE_PRICE_PARENT_QUARTERLY=${finalPrices.QUARTERLY}`);
  console.log(`STRIPE_PRICE_PARENT_YEARLY=${finalPrices.YEARLY}`);
  console.log('='.repeat(50));
  console.log('\n✅ Stripe products seeded successfully!');
}

seedProducts().catch(console.error);
