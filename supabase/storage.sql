-- Storage for job photos. Run once, in the Supabase SQL editor.
--
-- Separate from the numbered migrations because buckets live in Supabase's own
-- `storage` schema, which the schema verification script does not stand up.
-- Running this twice is safe.

-- Private, not public: a job photo is a customer's property and a customer's
-- basement. The app hands out short-lived signed URLs instead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-photos', 'job-photos', false, 20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The path is org/job/phase/file, so the first folder is the org id. Checking
-- it against the caller's own org is what stops one customer's photos being
-- readable by another's login even if a path leaks.
drop policy if exists job_photos_read on storage.objects;
create policy job_photos_read on storage.objects for select
  to authenticated
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
  );

drop policy if exists job_photos_write on storage.objects;
create policy job_photos_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
  );

-- Deleting a photo is job.edit, the same flag that governs the row in
-- job_photos. The crew add; the office removes.
drop policy if exists job_photos_remove on storage.objects;
create policy job_photos_remove on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = public.auth_org_id()::text
    and public.has_permission('job.edit')
  );
