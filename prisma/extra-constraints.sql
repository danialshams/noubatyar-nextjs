-- Install ONCE after Prisma schema is applied. Idempotent on reruns.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_staff_exclusion') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT booking_staff_exclusion
      EXCLUDE USING gist ("staffId" WITH =, tstzrange("blockStart","blockEnd",'[)') WITH &&)
      WHERE (status IN ('pending','confirmed','checked_in','completed') AND "groupKey" IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_resource_exclusion') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT booking_resource_exclusion
      EXCLUDE USING gist ("resourceId" WITH =, tstzrange("blockStart","blockEnd",'[)') WITH &&)
      WHERE ("resourceId" IS NOT NULL AND status IN ('pending','confirmed','checked_in','completed') AND "groupKey" IS NULL);
  END IF;
END $$;
-- Enforce critical referential integrity (Prisma schema uses portable scalar IDs).
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='fk_booking_org') THEN
   ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_org FOREIGN KEY ("orgId") REFERENCES "Organization"("id");
   ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_branch FOREIGN KEY ("branchId") REFERENCES "Branch"("id");
   ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_staff FOREIGN KEY ("staffId") REFERENCES "Staff"("id");
   ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_service FOREIGN KEY ("serviceId") REFERENCES "Service"("id");
   ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_customer FOREIGN KEY ("customerId") REFERENCES "Customer"("id");
   ALTER TABLE "Payment" ADD CONSTRAINT fk_payment_booking FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id");
   ALTER TABLE "StaffService" ADD CONSTRAINT fk_staffservice_staff FOREIGN KEY ("staffId") REFERENCES "Staff"("id");
   ALTER TABLE "StaffService" ADD CONSTRAINT fk_staffservice_service FOREIGN KEY ("serviceId") REFERENCES "Service"("id");
   ALTER TABLE "StaffHours" ADD CONSTRAINT fk_hours_staff FOREIGN KEY ("staffId") REFERENCES "Staff"("id");
   ALTER TABLE "BranchHours" ADD CONSTRAINT fk_hours_branch FOREIGN KEY ("branchId") REFERENCES "Branch"("id");
 END IF;
END $$;

-- Extra consistency and tenant-isolation barriers. These complement server-side authorization.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='chk_appointment_intervals') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT chk_appointment_intervals
      CHECK ("blockStart" <= "startsAt" AND "startsAt" < "endsAt" AND "endsAt" <= "blockEnd");
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='chk_service_numbers') THEN
    ALTER TABLE "Service" ADD CONSTRAINT chk_service_numbers
      CHECK (duration > 0 AND price >= 0 AND deposit >= 0 AND deposit <= price AND capacity > 0 AND "bufferBefore" >= 0 AND "bufferAfter" >= 0);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='chk_payment_positive') THEN
    ALTER TABLE "Payment" ADD CONSTRAINT chk_payment_positive CHECK (amount > 0);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='chk_branch_hours') THEN
    ALTER TABLE "BranchHours" ADD CONSTRAINT chk_branch_hours CHECK (weekday BETWEEN 0 AND 6 AND opens < closes);
    ALTER TABLE "StaffHours" ADD CONSTRAINT chk_staff_hours CHECK (weekday BETWEEN 0 AND 6 AND starts < ends AND
      (("breakStart" IS NULL AND "breakEnd" IS NULL) OR
       ("breakStart" IS NOT NULL AND "breakEnd" IS NOT NULL AND "breakStart" < "breakEnd" AND starts <= "breakStart" AND "breakEnd" <= ends)));
  END IF;
END $$;

-- Composite tenant FKs prevent cross-business references even if application code regresses.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='uq_branch_org') THEN
  ALTER TABLE "Branch" ADD CONSTRAINT uq_branch_org UNIQUE (id,"orgId");
  ALTER TABLE "Staff" ADD CONSTRAINT uq_staff_org UNIQUE (id,"orgId");
  ALTER TABLE "Service" ADD CONSTRAINT uq_service_org UNIQUE (id,"orgId");
  ALTER TABLE "Customer" ADD CONSTRAINT uq_customer_org UNIQUE (id,"orgId");
  ALTER TABLE "Resource" ADD CONSTRAINT uq_resource_org UNIQUE (id,"orgId");
  ALTER TABLE "Appointment" ADD CONSTRAINT uq_appointment_org UNIQUE (id,"orgId");
  ALTER TABLE "Package" ADD CONSTRAINT uq_package_org UNIQUE (id,"orgId");
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='fk_booking_branch_org') THEN
  ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_branch_org FOREIGN KEY ("branchId","orgId") REFERENCES "Branch" (id,"orgId");
  ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_staff_org FOREIGN KEY ("staffId","orgId") REFERENCES "Staff" (id,"orgId");
  ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_service_org FOREIGN KEY ("serviceId","orgId") REFERENCES "Service" (id,"orgId");
  ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_customer_org FOREIGN KEY ("customerId","orgId") REFERENCES "Customer" (id,"orgId");
  ALTER TABLE "Appointment" ADD CONSTRAINT fk_booking_resource_org FOREIGN KEY ("resourceId","orgId") REFERENCES "Resource" (id,"orgId");
  ALTER TABLE "Staff" ADD CONSTRAINT fk_staff_branch_org FOREIGN KEY ("branchId","orgId") REFERENCES "Branch" (id,"orgId");
  ALTER TABLE "Resource" ADD CONSTRAINT fk_resource_branch_org FOREIGN KEY ("branchId","orgId") REFERENCES "Branch" (id,"orgId");
  ALTER TABLE "Waitlist" ADD CONSTRAINT fk_waitlist_branch_org FOREIGN KEY ("branchId","orgId") REFERENCES "Branch" (id,"orgId");
  ALTER TABLE "Waitlist" ADD CONSTRAINT fk_waitlist_service_org FOREIGN KEY ("serviceId","orgId") REFERENCES "Service" (id,"orgId");
  ALTER TABLE "Payment" ADD CONSTRAINT fk_payment_appointment_org FOREIGN KEY ("appointmentId","orgId") REFERENCES "Appointment" (id,"orgId");
  ALTER TABLE "Package" ADD CONSTRAINT fk_package_service_org FOREIGN KEY ("serviceId","orgId") REFERENCES "Service" (id,"orgId");
  ALTER TABLE "CustomerPackage" ADD CONSTRAINT fk_customerpackage_customer_org FOREIGN KEY ("customerId","orgId") REFERENCES "Customer" (id,"orgId");
  ALTER TABLE "CustomerPackage" ADD CONSTRAINT fk_customerpackage_package_org FOREIGN KEY ("packageId","orgId") REFERENCES "Package" (id,"orgId");
 END IF;
END $$;

-- Group and exclusive bookings may never overlap unless they share the same group slot,
-- and that slot still has room. Advisory locks serialize competing inserts.
CREATE OR REPLACE FUNCTION noubatyar_enforce_capacity() RETURNS trigger
LANGUAGE plpgsql AS $booking$
DECLARE
  v_capacity INTEGER;
  v_other INTEGER;
  v_group INTEGER;
  v_key TEXT;
BEGIN
  IF NEW.status NOT IN ('pending','confirmed','checked_in','completed') THEN RETURN NEW; END IF;
  IF NEW."blockStart" >= NEW."blockEnd" THEN RAISE EXCEPTION 'Invalid booking interval' USING ERRCODE='23514'; END IF;
  FOR v_key IN SELECT DISTINCT key FROM (
     SELECT 'staff:' || NEW."staffId"::text AS key
     UNION ALL
     SELECT 'resource:' || NEW."resourceId"::text WHERE NEW."resourceId" IS NOT NULL
  ) keys ORDER BY key LOOP
     PERFORM pg_advisory_xact_lock(hashtext(v_key));
  END LOOP;
  SELECT capacity INTO v_capacity FROM "Service" WHERE id=NEW."serviceId" AND "orgId"=NEW."orgId";
  IF v_capacity IS NULL THEN RAISE EXCEPTION 'Invalid service or tenant' USING ERRCODE='23503'; END IF;
  IF NEW."groupKey" IS NOT NULL AND v_capacity <= 1 THEN RAISE EXCEPTION 'Group booking requires capacity greater than one' USING ERRCODE='23514'; END IF;
  SELECT COUNT(*) INTO v_other FROM "Appointment" a
   WHERE a."id"<>NEW."id" AND a.status IN ('pending','confirmed','checked_in','completed')
     AND (a."staffId"=NEW."staffId" OR (NEW."resourceId" IS NOT NULL AND a."resourceId"=NEW."resourceId"))
     AND tstzrange(a."blockStart",a."blockEnd",'[)') && tstzrange(NEW."blockStart",NEW."blockEnd",'[)')
     AND (NEW."groupKey" IS NULL OR a."groupKey" IS DISTINCT FROM NEW."groupKey" OR a."staffId"<>NEW."staffId");
  IF v_other > 0 THEN RAISE EXCEPTION 'BOOKING_CONFLICT: overlapping group or exclusive booking' USING ERRCODE='23P01'; END IF;
  IF NEW."groupKey" IS NOT NULL THEN
    SELECT COUNT(*) INTO v_group FROM "Appointment" a
     WHERE a."id"<>NEW."id" AND a."groupKey"=NEW."groupKey" AND a."staffId"=NEW."staffId"
       AND a."serviceId"=NEW."serviceId" AND a.status IN ('pending','confirmed','checked_in','completed');
    IF v_group >= v_capacity THEN RAISE EXCEPTION 'BOOKING_CONFLICT: group at capacity' USING ERRCODE='23P01'; END IF;
  END IF;
  RETURN NEW;
END;
$booking$;
DROP TRIGGER IF EXISTS trg_noubatyar_enforce_capacity ON "Appointment";
CREATE TRIGGER trg_noubatyar_enforce_capacity BEFORE INSERT OR UPDATE OF "startsAt","endsAt","blockStart","blockEnd",status,"staffId","resourceId","groupKey" ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION noubatyar_enforce_capacity();

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='fk_credit_customer_org') THEN
   ALTER TABLE "CreditTransaction" ADD CONSTRAINT fk_credit_customer_org FOREIGN KEY ("customerId","orgId") REFERENCES "Customer" (id,"orgId");
   ALTER TABLE "PackageUsage" ADD CONSTRAINT fk_packageusage_appointment_org FOREIGN KEY ("appointmentId","orgId") REFERENCES "Appointment" (id,"orgId");
   ALTER TABLE "PackageUsage" ADD CONSTRAINT chk_packageusage_date CHECK ("createdAt" IS NOT NULL);
 END IF;
END $$;
