#!/bin/bash

docker exec -it everletter-ops-crm_postgres_1 psql -U everletter -d everletter_dev -c "TRUNCATE subscribers, subscriptions, orders, mailings, mailing_components, exceptions, ingestion_events, staging_locations;"
