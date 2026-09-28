-- Sustituye TU_CORREO_DEL_LOGIN por el correo que ya usas en la aplicación.
-- Ejecutar completo desde SQL Editor como administrador del proyecto.
begin;

do $$
declare
  login_email text := 'TU_CORREO_DEL_LOGIN';
  matched_user_id uuid;
begin
  if login_email = 'TU_CORREO_DEL_LOGIN' then
    raise exception 'Primero reemplaza TU_CORREO_DEL_LOGIN por tu correo del login.';
  end if;

  select id into strict matched_user_id
  from auth.users
  where lower(email) = lower(btrim(login_email));

  insert into public.inventory_members (user_id)
  values (matched_user_id)
  on conflict (user_id) do nothing;
exception
  when no_data_found then
    raise exception 'Ese correo no existe en Authentication > Users de este proyecto.';
  when too_many_rows then
    raise exception 'Hay más de una cuenta con ese correo. Revisa Authentication > Users.';
end;
$$;

commit;

select u.email, m.created_at as authorized_at
from public.inventory_members m
join auth.users u on u.id = m.user_id
order by m.created_at;
