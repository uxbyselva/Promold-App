import { supabaseServer } from './supabase-server';

/** Customers, their sites, the templates and the staff list — what every job
 *  form needs to offer a choice. */
export async function jobFormOptions() {
  const supabase = await supabaseServer();
  const [{ data: customers }, { data: sites }, { data: templates }, { data: people }] =
    await Promise.all([
      supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
      supabase
        .from('sites')
        // The address, not just the label: a job is a place before it is
        // anything else, and the job page leads with it.
        .select('id, customer_id, label, address_line1, address_line2, city, state, postal_code')
        .eq('is_active', true)
        .order('label'),
      supabase
        .from('job_templates')
        .select('id, name, default_duration_hours, category')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('profiles_safe')
        .select('id, full_name')
        .eq('is_active', true)
        .order('full_name'),
    ]);

  return {
    customers: customers ?? [],
    sites: sites ?? [],
    templates: templates ?? [],
    people: people ?? [],
  };
}
