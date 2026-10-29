import { describe, expect, it } from 'vitest';
import { refusalMessage } from '../index';

describe('refusalMessage', () => {
  it('keeps the sentence a database guard was written to say', () => {
    expect(refusalMessage({ message: 'P0001: This customer still has 3 sites' })).toBe(
      'This customer still has 3 sites',
    );
  });

  it('falls back to the whole message when there is no prefix to strip', () => {
    expect(refusalMessage({ message: 'Already booked.' })).toBe('Already booked.');
  });

  it('is null for no error at all', () => {
    expect(refusalMessage(null)).toBeNull();
  });

  /*
   * The one that matters, and the reason this file exists.
   *
   * A deploy that reaches Vercel before its migration reaches Supabase makes
   * every screen that calls a changed function fail with a wall of parameter
   * names. Somebody trying to book a job reads
   *
   *   Could not find the function public.create_job_with_site(p_category,
   *   p_crew, … p_title) in the schema cache
   *
   * and concludes the app is broken. It is one SQL file behind, and the
   * message should say so.
   */
  it('turns a schema-cache miss into the instruction that fixes it', () => {
    const said = refusalMessage({
      code: 'PGRST202',
      message:
        'Could not find the function public.create_job_with_site(p_category, p_crew, ' +
        'p_customer_id, p_title) in the schema cache',
    });
    expect(said).toContain('database has not been updated');
    expect(said).toContain('update-from-');
    expect(said).toContain('Nothing has been saved');
    expect(said).not.toContain('p_category');
  });

  it('recognises it from the message alone, for clients that drop the code', () => {
    const said = refusalMessage({
      message: 'Could not find the function public.set_job_price(p_x) in the schema cache',
    });
    expect(said).toContain('database has not been updated');
  });
});
