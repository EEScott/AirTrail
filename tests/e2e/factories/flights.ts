import { db } from '@test/db';

export interface FlightInput {
  date: string;
  flightReason?: 'leisure' | 'business' | 'crew' | 'other' | null;
  note?: string | null;
}

export interface LegInput {
  fromId: number;
  toId: number;
  departure?: string | null;
  arrival?: string | null;
  duration?: number | null;
  flightNumber?: string | null;
  aircraftReg?: string | null;
  aircraftId?: number | null;
  airlineId?: number | null;
}

export interface FlightWithSeats extends FlightInput {
  userId: string;
  // Leg data (for backward compatibility, used as single leg)
  fromId: number;
  toId: number;
  departure?: string | null;
  arrival?: string | null;
  duration?: number | null;
  flightNumber?: string | null;
  aircraftReg?: string | null;
  aircraftId?: number | null;
  airlineId?: number | null;
  seat?: {
    seat?:
      | 'window'
      | 'aisle'
      | 'middle'
      | 'pilot'
      | 'copilot'
      | 'jumpseat'
      | 'other'
      | null;
    seatNumber?: string | null;
    seatClass?:
      | 'economy'
      | 'economy+'
      | 'business'
      | 'first'
      | 'private'
      | null;
    guestName?: string | null;
  };
}

export const flightsFactory = {
  async create(input: FlightWithSeats): Promise<{ flight: { id: number } }> {
    // Insert flight (only flight-level fields)
    const flightResult = await db
      .insertInto('flight')
      .values({
        date: input.date,
        flightReason: input.flightReason ?? null,
        note: input.note ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Insert leg with per-segment fields
    const legResult = await db
      .insertInto('leg')
      .values({
        flightId: flightResult.id,
        legOrder: 0,
        fromId: input.fromId,
        toId: input.toId,
        departure: input.departure ?? null,
        arrival: input.arrival ?? null,
        duration: input.duration ?? null,
        flightNumber: input.flightNumber ?? null,
        aircraftReg: input.aircraftReg ?? null,
        aircraftId: input.aircraftId ?? null,
        airlineId: input.airlineId ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Insert seat for the leg
    await db
      .insertInto('seat')
      .values({
        legId: legResult.id,
        userId: input.userId,
        seat: input.seat?.seat ?? null,
        seatNumber: input.seat?.seatNumber ?? null,
        seatClass: input.seat?.seatClass ?? null,
        guestName: input.seat?.guestName ?? null,
      })
      .execute();

    return { flight: { id: flightResult.id } };
  },
};
