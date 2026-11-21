DO $$
DECLARE
  review_row squarespace_order_reviews%ROWTYPE;
  remote jsonb;
  customer_email text;
  remote_id text;
  subscriber_id text;
  subscription_id text := 'PLAN-NORTH-POLE-03085';
  order_id text;
  existing_customers integer;
  personalization text := 'helped when I was in the hospital like such a good, big boy plus remembered to pick up all of your toys without being asked, I''m so proud of you';
BEGIN
  SELECT * INTO review_row
  FROM squarespace_order_reviews
  WHERE ltrim(order_number, '0') = '3085' AND status = 'Pending'
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM orders
    WHERE ltrim(external_order_number, '0') = '3085'
  ) THEN
    UPDATE squarespace_order_reviews
    SET status = 'Imported', reviewed_at = now()
    WHERE id = review_row.id;
    RETURN;
  END IF;

  remote := review_row.snapshot;
  customer_email := lower(trim(remote->>'customerEmail'));
  remote_id := trim(remote->>'id');
  IF customer_email = '' OR remote_id = '' THEN
    RAISE EXCEPTION 'Order 3085 is missing its Squarespace customer email or order id';
  END IF;

  SELECT count(*) INTO existing_customers
  FROM subscribers
  WHERE lower(email) = customer_email;
  IF existing_customers > 1 THEN
    RAISE EXCEPTION 'Order 3085 matches more than one subscriber email';
  END IF;

  SELECT id INTO subscriber_id
  FROM subscribers
  WHERE lower(email) = customer_email
  LIMIT 1;

  IF subscriber_id IS NULL THEN
    subscriber_id := 'SUB-NORTH-POLE-' || upper(substr(md5(customer_email), 1, 16));
    INSERT INTO subscribers (id, email, name)
    VALUES (subscriber_id, customer_email, 'Amy Farkas');
  ELSE
    UPDATE subscribers SET name = 'Amy Farkas' WHERE id = subscriber_id;
  END IF;

  INSERT INTO subscriptions (
    id, subscriber_id, character, term_type, status, started_at,
    total_letters_expected, recipient_name, address_line1, address_line2,
    city, state, zip
  ) VALUES (
    subscription_id, subscriber_id, 'North Pole', 'One-time', 'Active',
    (remote->>'createdOn')::timestamptz, 1, 'Joseph Howell',
    '120 Springbird Court', NULL, 'Wilmington', 'OH', '45177'
  ) ON CONFLICT (id) DO UPDATE SET
    subscriber_id = EXCLUDED.subscriber_id,
    character = EXCLUDED.character,
    term_type = EXCLUDED.term_type,
    status = EXCLUDED.status,
    total_letters_expected = 1,
    recipient_name = EXCLUDED.recipient_name,
    address_line1 = EXCLUDED.address_line1,
    address_line2 = EXCLUDED.address_line2,
    city = EXCLUDED.city,
    state = EXCLUDED.state,
    zip = EXCLUDED.zip;

  order_id := 'SQ-' || remote_id;
  INSERT INTO orders (
    id, subscription_id, external_order_number, ordered_at,
    billing_address_line_1, billing_address_line_2, billing_city,
    billing_state, billing_zip, billing_country,
    child_first_name, preferred_woodland_character,
    north_pole_personalization
  ) VALUES (
    order_id, subscription_id, '3085', (remote->>'createdOn')::timestamptz,
    nullif(remote->>'billingAddressLine1', ''),
    nullif(remote->>'billingAddressLine2', ''),
    nullif(remote->>'billingCity', ''),
    nullif(remote->>'billingState', ''),
    nullif(remote->>'billingPostalCode', ''),
    nullif(remote->>'billingCountry', ''),
    'Joe', 'Ringo', personalization
  );

  INSERT INTO mailings (
    id, subscription_id, app_mailing_id, last_source_row, letter_number,
    scheduled_date, status, active, notes, recipient_name,
    address_line1, address_line2, city, state, zip
  ) VALUES (
    order_id || '::North Pole::1', subscription_id,
    'MAIL-NORTH-POLE-03085', '1030850001', 1,
    DATE '2026-12-01', 'To Prepare', true,
    'Imported from Squarespace order #03085; NORTH POLE CHILD FIRST NAME: Joe; PREFERRED WOODLAND CHARACTER: Ringo; NORTH POLE PERSONALIZATION: ' || personalization,
    'Joseph Howell', '120 Springbird Court', NULL, 'Wilmington', 'OH', '45177'
  );

  UPDATE squarespace_order_reviews
  SET status = 'Imported', reviewed_at = now()
  WHERE id = review_row.id;

  INSERT INTO ingestion_events (source, raw_payload, status, summary)
  VALUES (
    'squarespace_sync',
    jsonb_build_object('order', remote, 'authorizedRecovery', '3085'),
    'success',
    'Imported Squarespace order 3085: 1 mailing(s)'
  );

  INSERT INTO audit_events (
    actor_email, kind, item_key, previous_value, new_value
  ) VALUES (
    'authorized-production-recovery', 'squarespaceImport', remote_id,
    'Pending review',
    subscriber_id || '; ' || subscription_id || '; 1 mailing(s)'
  );
END $$;
