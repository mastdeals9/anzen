import { supabase } from '../lib/supabase';

interface NotificationParams {
  userId: string;
  type: 'low_stock' | 'near_expiry' | 'pending_invoice' | 'follow_up';
  title: string;
  message: string;
  referenceId?: string;
  referenceType?: string;
}

export async function createNotification(params: NotificationParams) {
  try {
    const { error } = await supabase
      .from('notifications')
      .insert([{
        user_id: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        reference_id: params.referenceId || null,
        reference_type: params.referenceType || null,
        is_read: false,
      }]);

    if (error) throw error;
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

export async function checkAndCreateLowStockNotifications() {
  try {
    const { data: products } = await supabase
      .from('products')
      .select('id, product_name, min_stock_level')
      .gt('min_stock_level', 0);

    if (!products || products.length === 0) return;

    const lowStockProducts = [];
    for (const product of products) {
      const { data: batches } = await supabase
        .from('batches')
        .select('current_stock')
        .eq('product_id', product.id)
        .eq('is_active', true);

      const totalStock = batches?.reduce((sum, batch) => sum + (batch.current_stock || 0), 0) || 0;

      if (totalStock < product.min_stock_level) {
        lowStockProducts.push({
          product_name: product.product_name,
          current_stock: totalStock,
          min_stock_level: product.min_stock_level
        });
      }
    }

    if (lowStockProducts && lowStockProducts.length > 0) {
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('is_active', true)
        .in('role', ['admin', 'warehouse']);

      if (users) {
        for (const user of users) {
          const message = `${lowStockProducts.length} product(s) are running low on stock.`;

          // Create only when content is new (gmail-like behavior after mark-as-read)
          const { data: existingNotification } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', user.id)
            .eq('type', 'low_stock')
            .eq('message', message)
            .limit(1);

          if (!existingNotification?.length) {
            await createNotification({
              userId: user.id,
              type: 'low_stock',
              title: 'Low Stock Alert',
              message,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking low stock:', error);
  }
}

export async function checkAndCreateExpiryNotifications() {
  try {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('expiry_alert_days')
      .limit(1)
      .maybeSingle();

    const alertDays = settings?.expiry_alert_days || 30;
    const alertDate = new Date();
    alertDate.setDate(alertDate.getDate() + alertDays);

    const { data: nearExpiryBatches } = await supabase
      .from('batches')
      .select('id, batch_number, expiry_date, products(product_name)')
      .eq('is_active', true)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', alertDate.toISOString())
      .gte('expiry_date', new Date().toISOString());

    if (nearExpiryBatches && nearExpiryBatches.length > 0) {
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('is_active', true)
        .in('role', ['admin', 'warehouse', 'sales']);

      if (users) {
        for (const user of users) {
          const message = `${nearExpiryBatches.length} batch(es) will expire within ${alertDays} days.`;

          const { data: existingNotification } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', user.id)
            .eq('type', 'near_expiry')
            .eq('message', message)
            .limit(1);

          if (!existingNotification?.length) {
            await createNotification({
              userId: user.id,
              type: 'near_expiry',
              title: 'Products Near Expiry',
              message,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking expiry dates:', error);
  }
}

export async function checkAndCreateFollowUpNotifications() {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: dueActivities } = await supabase
      .from('crm_activities')
      .select('id, customer_id, activity_type, crm_contacts(company_name)')
      .eq('is_completed', false)
      .not('follow_up_date', 'is', null)
      .lte('follow_up_date', today);

    if (dueActivities && dueActivities.length > 0) {
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('is_active', true)
        .in('role', ['admin', 'sales']);

      if (users) {
        for (const user of users) {
          const message = `You have ${dueActivities.length} follow-up(s) due today.`;

          const { data: existingNotification } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', user.id)
            .eq('type', 'follow_up')
            .eq('message', message)
            .limit(1);

          if (!existingNotification?.length) {
            await createNotification({
              userId: user.id,
              type: 'follow_up',
              title: 'Follow-ups Due',
              message,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking follow-ups:', error);
  }
}

let notificationInterval: NodeJS.Timeout | null = null;

export async function initializeNotificationChecks() {
  if (notificationInterval) {
    clearInterval(notificationInterval);
  }

  await checkAndCreateLowStockNotifications();
  await checkAndCreateExpiryNotifications();
  await checkAndCreateFollowUpNotifications();

  notificationInterval = setInterval(async () => {
    await checkAndCreateLowStockNotifications();
    await checkAndCreateExpiryNotifications();
    await checkAndCreateFollowUpNotifications();
  }, 600000);
}
