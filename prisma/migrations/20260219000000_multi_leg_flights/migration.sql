-- CreateTable
CREATE TABLE "leg" (
    "id" SERIAL NOT NULL,
    "flight_id" INTEGER NOT NULL,
    "leg_order" INTEGER NOT NULL,
    "departure" TEXT,
    "arrival" TEXT,
    "departure_scheduled" TEXT,
    "arrival_scheduled" TEXT,
    "takeoff_scheduled" TEXT,
    "takeoff_actual" TEXT,
    "landing_scheduled" TEXT,
    "landing_actual" TEXT,
    "duration" INTEGER,
    "departure_terminal" TEXT,
    "departure_gate" TEXT,
    "arrival_terminal" TEXT,
    "arrival_gate" TEXT,
    "flight_number" TEXT,
    "aircraft_reg" TEXT,
    "from_id" INTEGER,
    "to_id" INTEGER,
    "aircraft_id" INTEGER,
    "airline_id" INTEGER,

    CONSTRAINT "leg_pkey" PRIMARY KEY ("id")
);

-- Migrate existing flight data into leg (one leg per flight, leg_order = 0)
INSERT INTO "leg" (
    "flight_id", "leg_order",
    "departure", "arrival",
    "departure_scheduled", "arrival_scheduled",
    "takeoff_scheduled", "takeoff_actual",
    "landing_scheduled", "landing_actual",
    "duration",
    "departure_terminal", "departure_gate",
    "arrival_terminal", "arrival_gate",
    "flight_number", "aircraft_reg",
    "from_id", "to_id", "aircraft_id", "airline_id"
)
SELECT
    "id", 0,
    "departure", "arrival",
    "departure_scheduled", "arrival_scheduled",
    "takeoff_scheduled", "takeoff_actual",
    "landing_scheduled", "landing_actual",
    "duration",
    "departure_terminal", "departure_gate",
    "arrival_terminal", "arrival_gate",
    "flight_number", "aircraft_reg",
    "from_id", "to_id", "aircraft_id", "airline_id"
FROM "flight";

-- Add leg_id to seat (nullable first)
ALTER TABLE "seat" ADD COLUMN "leg_id" INTEGER;

-- Populate leg_id from the migrated legs
UPDATE "seat"
SET "leg_id" = "leg"."id"
FROM "leg"
WHERE "leg"."flight_id" = "seat"."flight_id";

-- Make leg_id NOT NULL
ALTER TABLE "seat" ALTER COLUMN "leg_id" SET NOT NULL;

-- Drop old seat constraints and flight_id column
ALTER TABLE "seat" DROP CONSTRAINT IF EXISTS "seat_user_id_flight_id_key";
ALTER TABLE "seat" DROP CONSTRAINT IF EXISTS "seat_flight_id_guest_name_key";
ALTER TABLE "seat" DROP CONSTRAINT IF EXISTS "seat_flight_id_fkey";
DROP INDEX IF EXISTS "seat_user_id_flight_id_key";
DROP INDEX IF EXISTS "seat_flight_id_guest_name_key";
ALTER TABLE "seat" DROP COLUMN "flight_id";

-- Add new seat constraints
ALTER TABLE "seat" ADD CONSTRAINT "seat_leg_id_user_id_key" UNIQUE ("leg_id", "user_id");
ALTER TABLE "seat" ADD CONSTRAINT "seat_leg_id_guest_name_key" UNIQUE ("leg_id", "guest_name");

-- Drop per-segment columns from flight
ALTER TABLE "flight" DROP COLUMN "departure";
ALTER TABLE "flight" DROP COLUMN "arrival";
ALTER TABLE "flight" DROP COLUMN "departure_scheduled";
ALTER TABLE "flight" DROP COLUMN "arrival_scheduled";
ALTER TABLE "flight" DROP COLUMN "takeoff_scheduled";
ALTER TABLE "flight" DROP COLUMN "takeoff_actual";
ALTER TABLE "flight" DROP COLUMN "landing_scheduled";
ALTER TABLE "flight" DROP COLUMN "landing_actual";
ALTER TABLE "flight" DROP COLUMN "duration";
ALTER TABLE "flight" DROP COLUMN "departure_terminal";
ALTER TABLE "flight" DROP COLUMN "departure_gate";
ALTER TABLE "flight" DROP COLUMN "arrival_terminal";
ALTER TABLE "flight" DROP COLUMN "arrival_gate";
ALTER TABLE "flight" DROP COLUMN "flight_number";
ALTER TABLE "flight" DROP COLUMN "aircraft_reg";
ALTER TABLE "flight" DROP COLUMN "from_id";
ALTER TABLE "flight" DROP COLUMN "to_id";
ALTER TABLE "flight" DROP COLUMN "aircraft_id";
ALTER TABLE "flight" DROP COLUMN "airline_id";

-- Drop old flight indexes
DROP INDEX IF EXISTS "flight_from_id_idx";
DROP INDEX IF EXISTS "flight_to_id_idx";

-- Add leg indexes and constraints
CREATE UNIQUE INDEX "leg_flight_id_leg_order_key" ON "leg"("flight_id", "leg_order");
CREATE INDEX "leg_flight_id_idx" ON "leg"("flight_id");
CREATE INDEX "leg_from_id_idx" ON "leg"("from_id");
CREATE INDEX "leg_to_id_idx" ON "leg"("to_id");

-- AddForeignKey
ALTER TABLE "leg" ADD CONSTRAINT "leg_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leg" ADD CONSTRAINT "leg_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "airport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leg" ADD CONSTRAINT "leg_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "airport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leg" ADD CONSTRAINT "leg_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leg" ADD CONSTRAINT "leg_airline_id_fkey" FOREIGN KEY ("airline_id") REFERENCES "airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey for seat -> leg
ALTER TABLE "seat" ADD CONSTRAINT "seat_leg_id_fkey" FOREIGN KEY ("leg_id") REFERENCES "leg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
