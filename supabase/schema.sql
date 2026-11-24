-- =====================================================================
--  Учёт магазина — схема облачной базы данных (Supabase / PostgreSQL)
--  Выполните этот файл целиком: Supabase → SQL Editor → New query → Run.
--  Скрипт можно запускать повторно — он не удаляет данные.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Сотрудники ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null default '',
  role text not null default 'pending'
    check (role in ('owner','manager','cashier','pending','blocked')),
  created_at timestamptz not null default now()
);

-- Первый зарегистрированный пользователь становится владельцем,
-- остальные ждут подтверждения владельцем.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(42001);
  insert into public.profiles(id, email, name, role)
  values (
    new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
    case when exists (select 1 from public.profiles where role = 'owner') then 'pending' else 'owner' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('owner','manager','cashier'), false) $$;

create or replace function public.is_manager() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('owner','manager'), false) $$;

create or replace function public.is_owner() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'owner', false) $$;

-- ---------- Справочники ----------
create table if not exists public.settings (
  key text primary key,
  value jsonb
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.banks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into public.banks(name) values
  ('Halyk Bank'), ('Freedom Bank'), ('Forte Bank'), ('Jusan Bank'),
  ('Bank CenterCredit'), ('Home Credit Bank'), ('Евразийский банк')
on conflict (name) do nothing;

insert into public.settings(key, value) values ('shop_name', '"Мой магазин"')
on conflict (key) do nothing;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  barcode text unique,
  category_id uuid references public.categories(id) on delete set null,
  purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  stock numeric(14,3) not null default 0,
  unit text not null default 'шт',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_name_idx on public.products (lower(name));

-- Остаток меняется ТОЛЬКО через операции (продажа, приход, ревизия...).
-- Прямое редактирование поля stock игнорируется.
create or replace function public.protect_stock() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.stock_ok', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.stock := 0;
    elsif new.stock is distinct from old.stock then
      new.stock := old.stock;
    end if;
  end if;
  new.barcode := nullif(trim(new.barcode), '');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists products_protect_stock on public.products;
create trigger products_protect_stock before insert or update on public.products
  for each row execute function public.protect_stock();

-- ---------- Операции ----------
create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  number bigserial unique,
  type text not null check (type in ('sale','receipt','writeoff','return','audit','cancel')),
  status text not null default 'done' check (status in ('done','cancelled')),
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  user_name text,
  total numeric(14,2) not null default 0,
  cost_total numeric(14,2) not null default 0,
  comment text,
  reason text,
  supplier text,
  ref_id uuid references public.operations(id)
);
create index if not exists operations_created_idx on public.operations (created_at desc);
create index if not exists operations_ref_idx on public.operations (ref_id);

create table if not exists public.operation_items (
  id bigserial primary key,
  operation_id uuid not null references public.operations(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  qty numeric(14,3) not null,
  delta numeric(14,3) not null,
  price numeric(14,2) not null default 0,
  cost numeric(14,2) not null default 0,
  expected_qty numeric(14,3),
  actual_qty numeric(14,3)
);
create index if not exists operation_items_op_idx on public.operation_items (operation_id);
create index if not exists operation_items_product_idx on public.operation_items (product_id);

create table if not exists public.payments (
  id bigserial primary key,
  operation_id uuid not null references public.operations(id) on delete cascade,
  method text not null check (method in ('cash','kaspi','bank')),
  bank_name text,
  amount numeric(14,2) not null check (amount > 0)
);
create index if not exists payments_op_idx on public.payments (operation_id);

-- ---------- Проведение операции (атомарно, в одной транзакции) ----------
create or replace function public.post_operation(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.my_role();
  v_type text := p->>'type';
  v_id uuid := gen_random_uuid();
  v_ref uuid := nullif(p->>'ref_id','')::uuid;
  v_item jsonb;
  v_pay jsonb;
  v_prod public.products%rowtype;
  v_qty numeric; v_delta numeric; v_price numeric; v_cost numeric;
  v_exp numeric; v_act numeric;
  v_total numeric := 0; v_cost_total numeric := 0; v_paid numeric := 0;
  v_name text;
  v_left numeric;
begin
  if v_role is null or v_role not in ('owner','manager','cashier') then
    raise exception 'Нет доступа';
  end if;
  if v_type is null or v_type not in ('sale','receipt','writeoff','return','audit') then
    raise exception 'Неизвестный тип операции';
  end if;
  if v_type in ('receipt','writeoff','audit') and v_role = 'cashier' then
    raise exception 'Недостаточно прав для этой операции';
  end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Нет товаров в операции';
  end if;

  if v_type = 'return' and v_ref is not null then
    perform 1 from public.operations where id = v_ref and type = 'sale' and status = 'done' for update;
    if not found then raise exception 'Продажа не найдена или отменена'; end if;
  end if;

  select name into v_name from public.profiles where id = auth.uid();

  insert into public.operations(id, type, user_id, user_name, comment, reason, supplier, ref_id)
  values (v_id, v_type, auth.uid(), v_name,
          nullif(trim(p->>'comment'),''), nullif(p->>'reason',''), nullif(trim(p->>'supplier'),''),
          case when v_type = 'return' then v_ref else null end);

  perform set_config('app.stock_ok', '1', true);

  for v_item in select value from jsonb_array_elements(p->'items') loop
    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'Товар не найден'; end if;
    v_exp := null; v_act := null;

    if v_type = 'receipt' then
      v_cost := coalesce((v_item->>'price')::numeric, v_prod.purchase_price);
    else
      v_cost := v_prod.purchase_price;
    end if;

    if v_type = 'audit' then
      v_exp := round(coalesce((v_item->>'expected_qty')::numeric, v_prod.stock), 3);
      v_act := round((v_item->>'actual_qty')::numeric, 3);
      if v_act is null or v_act < 0 then
        raise exception 'Неверное фактическое количество: %', v_prod.name;
      end if;
      v_delta := v_act - v_exp;
      v_qty := abs(v_delta);
      v_price := v_prod.sale_price;
      v_total := v_total + v_delta * v_cost;
      v_cost_total := v_cost_total + v_delta * v_cost;
    else
      v_qty := round((v_item->>'qty')::numeric, 3);
      if v_qty is null or v_qty <= 0 then
        raise exception 'Неверное количество: %', v_prod.name;
      end if;
      v_price := round(coalesce((v_item->>'price')::numeric,
        case when v_type in ('receipt','writeoff') then v_prod.purchase_price else v_prod.sale_price end), 2);
      if v_price < 0 then raise exception 'Неверная цена: %', v_prod.name; end if;
      v_delta := case when v_type in ('sale','writeoff') then -v_qty else v_qty end;
      v_total := v_total + v_qty * v_price;
      v_cost_total := v_cost_total + v_qty * v_cost;
    end if;

    if v_type = 'return' and v_ref is not null then
      select coalesce(sum(qty),0) into v_left from public.operation_items
        where operation_id = v_ref and product_id = v_prod.id;
      select v_left - coalesce(sum(i.qty),0) into v_left
        from public.operation_items i join public.operations o on o.id = i.operation_id
        where o.ref_id = v_ref and o.type = 'return' and o.status = 'done' and i.product_id = v_prod.id;
      if v_left - v_qty < -0.0001 then
        raise exception 'Количество возврата больше, чем было продано: %', v_prod.name;
      end if;
    end if;

    insert into public.operation_items(operation_id, product_id, product_name, qty, delta, price, cost, expected_qty, actual_qty)
    values (v_id, v_prod.id, v_prod.name, v_qty, v_delta, v_price, round(v_cost,2), v_exp, v_act);

    update public.products set
      stock = stock + v_delta,
      purchase_price = case when v_type = 'receipt' then v_price else purchase_price end,
      sale_price = case when v_type = 'receipt' and (v_item->>'new_sale_price') is not null
                        and (v_item->>'new_sale_price')::numeric >= 0
                        then round((v_item->>'new_sale_price')::numeric, 2) else sale_price end
    where id = v_prod.id;
  end loop;

  v_total := round(v_total, 2);
  v_cost_total := round(v_cost_total, 2);

  if v_type in ('sale','return') then
    if jsonb_typeof(p->'payments') is distinct from 'array' or jsonb_array_length(p->'payments') = 0 then
      raise exception 'Укажите способ оплаты';
    end if;
    for v_pay in select value from jsonb_array_elements(p->'payments') loop
      if (v_pay->>'method') not in ('cash','kaspi','bank') then raise exception 'Неверный способ оплаты'; end if;
      if coalesce((v_pay->>'amount')::numeric, 0) <= 0 then raise exception 'Сумма оплаты должна быть больше нуля'; end if;
      if v_pay->>'method' = 'bank' and coalesce(trim(v_pay->>'bank_name'),'') = '' then raise exception 'Укажите банк'; end if;
      insert into public.payments(operation_id, method, bank_name, amount)
      values (v_id, v_pay->>'method',
              case when v_pay->>'method' = 'bank' then trim(v_pay->>'bank_name') end,
              round((v_pay->>'amount')::numeric, 2));
      v_paid := v_paid + round((v_pay->>'amount')::numeric, 2);
    end loop;
    if abs(v_paid - v_total) > 0.009 then
      raise exception 'Сумма оплаты (%) не совпадает с суммой (%)', v_paid, v_total;
    end if;
  end if;

  update public.operations set total = v_total, cost_total = v_cost_total where id = v_id;
  return v_id;
end $$;

-- ---------- Отмена ошибочной продажи ----------
create or replace function public.cancel_sale(p_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sale public.operations%rowtype;
  v_id uuid := gen_random_uuid();
  v_name text;
begin
  if not public.is_manager() then raise exception 'Недостаточно прав для этой операции'; end if;
  select * into v_sale from public.operations where id = p_id for update;
  if not found or v_sale.type <> 'sale' then raise exception 'Продажа не найдена'; end if;
  if v_sale.status <> 'done' then raise exception 'Продажа уже отменена'; end if;
  if exists (select 1 from public.operations where ref_id = p_id and type = 'return' and status = 'done') then
    raise exception 'По этой продаже уже был возврат — отмена невозможна';
  end if;

  select name into v_name from public.profiles where id = auth.uid();
  insert into public.operations(id, type, user_id, user_name, total, cost_total, comment, ref_id)
  values (v_id, 'cancel', auth.uid(), v_name, v_sale.total, v_sale.cost_total, nullif(trim(p_reason),''), p_id);

  insert into public.operation_items(operation_id, product_id, product_name, qty, delta, price, cost)
  select v_id, product_id, product_name, qty, qty, price, cost from public.operation_items where operation_id = p_id;

  perform set_config('app.stock_ok', '1', true);
  update public.products pr set stock = pr.stock + s.q
  from (select product_id, sum(qty) q from public.operation_items where operation_id = p_id group by product_id) s
  where pr.id = s.product_id;

  update public.operations set status = 'cancelled' where id = p_id;
  return v_id;
end $$;

-- ---------- Права доступа (Row Level Security) ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.categories enable row level security;
alter table public.banks enable row level security;
alter table public.products enable row level security;
alter table public.operations enable row level security;
alter table public.operation_items enable row level security;
alter table public.payments enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (id = auth.uid() or public.is_staff());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (public.is_owner()) with check (public.is_owner());

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select using (public.is_staff());
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select using (public.is_staff());
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists banks_select on public.banks;
create policy banks_select on public.banks for select using (public.is_staff());
drop policy if exists banks_write on public.banks;
create policy banks_write on public.banks for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists products_select on public.products;
create policy products_select on public.products for select using (public.is_staff());
drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert with check (public.is_manager());
drop policy if exists products_update on public.products;
create policy products_update on public.products for update using (public.is_manager()) with check (public.is_manager());

-- Операции только читаются напрямую; создаются через функции post_operation / cancel_sale
drop policy if exists operations_select on public.operations;
create policy operations_select on public.operations for select using (public.is_staff());
drop policy if exists operation_items_select on public.operation_items;
create policy operation_items_select on public.operation_items for select using (public.is_staff());
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select using (public.is_staff());

-- Владелец не может случайно снять с себя роль владельца, если он единственный
create or replace function public.keep_one_owner() returns trigger
language plpgsql as $$
begin
  if old.role = 'owner' and new.role <> 'owner'
     and not exists (select 1 from public.profiles where role = 'owner' and id <> old.id) then
    raise exception 'Должен остаться хотя бы один владелец';
  end if;
  return new;
end $$;
drop trigger if exists profiles_keep_owner on public.profiles;
create trigger profiles_keep_owner before update on public.profiles
  for each row execute function public.keep_one_owner();

-- Доступ приложения к таблицам (работает и при выключенной галочке
-- «Grant API access to new tables automatically»). Что именно можно делать —
-- ограничивают правила RLS выше.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_owner() to authenticated;

grant execute on function public.post_operation(jsonb) to authenticated;
grant execute on function public.cancel_sale(uuid, text) to authenticated;
revoke execute on function public.post_operation(jsonb) from public, anon;
revoke execute on function public.cancel_sale(uuid, text) from public, anon;

-- ---------- Синхронизация в реальном времени ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.products;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
