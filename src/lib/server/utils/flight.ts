import type { TZDate } from '@date-fns/tz';
import { differenceInSeconds, format, isBefore, parseISO } from 'date-fns';
import { type Insertable, sql } from 'kysely';

import { db } from '$lib/db';
import {
  createFlightPrimitive,
  createManyFlightsPrimitive,
  getFlightPrimitive,
  listFlightBaseQuery,
  listFlightPrimitive,
  updateFlightPrimitive,
} from '$lib/db/queries';
import type { DB } from '$lib/db/schema';
import type { CreateFlight, CreateLeg, Flight, User } from '$lib/db/types';
import { distanceBetween } from '$lib/utils';
import {
  estimateFlightDuration,
  isBeforeEpoch,
  mergeTimeWithDate,
  parseLocalISO,
  toUtc,
} from '$lib/utils/datetime';
import type { ErrorActionResult } from '$lib/utils/forms';
import type { flightSchema } from '$lib/zod/flight';
import type { z } from 'zod';

export const listFlightsQuery = (userId: string) => {
  return listFlightBaseQuery(db, userId);
};

export const listFlights = async (userId: string) => {
  return await listFlightPrimitive(db, userId);
};

export const getFlight = async (id: number) => {
  return await getFlightPrimitive(db, id);
};

export const createFlight = async (data: CreateFlight) => {
  return await createFlightPrimitive(db, data);
};

type LegInput = z.infer<typeof flightSchema>['legs'][number];

const validateAndProcessLeg = (
  legData: LegInput,
  legIndex: number,
): { value: Omit<CreateLeg, 'seats'>; error?: never } | { value?: never; error: ErrorActionResult } => {
  const pathError = (path: string, message: string) => {
    return { error: { success: false, type: 'path' as const, path: `legs[${legIndex}].${path}`, message } };
  };

  const parseDateTimeField = (
    date: string | null,
    time: string | null,
    tzId: string,
    path: string,
  ) => {
    if (!date || !time) return { value: null as TZDate | null };
    try {
      return { value: mergeTimeWithDate(date, time, tzId) };
    } catch {
      return { error: pathError(path, 'Invalid time format').error };
    }
  };

  const from = legData.from;
  const to = legData.to;

  // Either departure or departureScheduled must be set
  if (!legData.departure && !legData.departureScheduled) {
    return pathError('departure', 'Select a departure date');
  }

  // Use departure if available, otherwise fall back to departureScheduled for the date field
  const primaryDepartureDate = legData.departure ?? legData.departureScheduled;
  const departureDate = parseISO(primaryDepartureDate!);
  if (isBeforeEpoch(departureDate)) {
    return pathError(
      legData.departure ? 'departure' : 'departureScheduled',
      'Too far in the past',
    );
  }

  let departure: TZDate | undefined;
  if (legData.departure) {
    try {
      departure = legData.departureTime
        ? mergeTimeWithDate(legData.departure, legData.departureTime, from.tz)
        : undefined;
    } catch {
      return pathError('departureTime', 'Invalid time format');
    }
  }

  const departureScheduledResult = parseDateTimeField(
    legData.departureScheduled,
    legData.departureScheduledTime,
    from.tz,
    'departureScheduledTime',
  );
  if (departureScheduledResult.error) return { error: departureScheduledResult.error };
  const departureScheduled = departureScheduledResult.value;

  const takeoffScheduledResult = parseDateTimeField(
    legData.takeoffScheduled,
    legData.takeoffScheduledTime,
    from.tz,
    'takeoffScheduledTime',
  );
  if (takeoffScheduledResult.error) return { error: takeoffScheduledResult.error };
  const takeoffScheduled = takeoffScheduledResult.value;

  const takeoffActualResult = parseDateTimeField(
    legData.takeoffActual,
    legData.takeoffActualTime,
    from.tz,
    'takeoffActualTime',
  );
  if (takeoffActualResult.error) return { error: takeoffActualResult.error };
  const takeoffActual = takeoffActualResult.value;

  const arrivalDate = legData.arrival
    ? parseLocalISO(legData.arrival, to.tz)
    : undefined;
  if (arrivalDate && isBeforeEpoch(arrivalDate)) {
    return pathError('arrival', 'Too far in the past');
  }
  if (arrivalDate && !legData.arrivalTime) {
    return pathError('arrival', 'Cannot have arrival date without time');
  }

  if (legData.arrivalTime && !legData.arrival) {
    legData.arrival = legData.departure;
  }

  let arrival: TZDate | undefined;
  try {
    arrival =
      legData.arrival && legData.arrivalTime
        ? mergeTimeWithDate(legData.arrival, legData.arrivalTime, to.tz)
        : undefined;
  } catch {
    return pathError('arrivalTime', 'Invalid time format');
  }

  const arrivalScheduledResult = parseDateTimeField(
    legData.arrivalScheduled,
    legData.arrivalScheduledTime,
    to.tz,
    'arrivalScheduledTime',
  );
  if (arrivalScheduledResult.error) return { error: arrivalScheduledResult.error };
  const arrivalScheduled = arrivalScheduledResult.value;

  const landingScheduledResult = parseDateTimeField(
    legData.landingScheduled,
    legData.landingScheduledTime,
    to.tz,
    'landingScheduledTime',
  );
  if (landingScheduledResult.error) return { error: landingScheduledResult.error };
  const landingScheduled = landingScheduledResult.value;

  const landingActualResult = parseDateTimeField(
    legData.landingActual,
    legData.landingActualTime,
    to.tz,
    'landingActualTime',
  );
  if (landingActualResult.error) return { error: landingActualResult.error };
  const landingActual = landingActualResult.value;

  if (arrival && departure && isBefore(arrival, departure)) {
    return pathError('arrival', 'Arrival must be after departure');
  }

  let duration: number | null = null;
  if (departure && arrival) {
    duration = differenceInSeconds(arrival, departure);
  } else if (from.id !== to.id) {
    const fromLonLat = { lon: from.lon, lat: from.lat };
    const toLonLat = { lon: to.lon, lat: to.lat };
    duration = estimateFlightDuration(
      distanceBetween(fromLonLat, toLonLat) / 1000,
    );
  }

  return {
    value: {
      from: legData.from,
      to: legData.to,
      duration,
      departure: departure ? toUtc(departure).toISOString() : null,
      arrival: arrival ? toUtc(arrival).toISOString() : null,
      departureScheduled: departureScheduled
        ? toUtc(departureScheduled).toISOString()
        : null,
      arrivalScheduled: arrivalScheduled
        ? toUtc(arrivalScheduled).toISOString()
        : null,
      takeoffScheduled: takeoffScheduled
        ? toUtc(takeoffScheduled).toISOString()
        : null,
      takeoffActual: takeoffActual ? toUtc(takeoffActual).toISOString() : null,
      landingScheduled: landingScheduled
        ? toUtc(landingScheduled).toISOString()
        : null,
      landingActual: landingActual ? toUtc(landingActual).toISOString() : null,
      departureTerminal: legData.departureTerminal ?? null,
      departureGate: legData.departureGate ?? null,
      arrivalTerminal: legData.arrivalTerminal ?? null,
      arrivalGate: legData.arrivalGate ?? null,
      flightNumber: legData.flightNumber,
      aircraft: legData.aircraft,
      aircraftReg: legData.aircraftReg,
      airline: legData.airline,
    },
  };
};

export const validateAndSaveFlight = async (
  user: User,
  data: z.infer<typeof flightSchema>,
): Promise<ErrorActionResult & { id?: number }> => {
  const processedLegs: CreateLeg[] = [];

  for (let i = 0; i < data.legs.length; i++) {
    const legData = data.legs[i]!;
    const result = validateAndProcessLeg(legData, i);
    if (result.error) {
      return result.error;
    }
    processedLegs.push({
      ...result.value,
      seats: legData.seats,
    });
  }

  // Derive flight date from first leg's departure
  const firstLeg = data.legs[0]!;
  const primaryDepartureDate = firstLeg.departure ?? firstLeg.departureScheduled;
  const departureDate = parseISO(primaryDepartureDate!);

  const values: CreateFlight = {
    date: format(departureDate, 'yyyy-MM-dd'),
    flightReason: data.flightReason,
    note: data.note,
    legs: processedLegs,
  };

  const updateId = data.id;
  if (updateId) {
    const flight = await getFlight(updateId);
    if (
      !flight?.legs.some((leg) =>
        leg.seats.some((seat) => seat.userId === user.id),
      )
    ) {
      return {
        success: false,
        type: 'httpError',
        status: 403,
        message: 'Flight not found or you do not have a seat on this flight',
      };
    }

    try {
      await updateFlight(updateId, values);
    } catch {
      return {
        success: false,
        type: 'error',
        message: 'Failed to update flight',
      };
    }

    return { success: true, message: 'Flight updated successfully' };
  }

  let flightId: number;
  try {
    flightId = await createFlight(values);
  } catch (_) {
    return {
      success: false,
      type: 'error',
      message: 'Failed to add flight',
    };
  }

  return {
    success: true,
    message: 'Flight added',
    id: flightId,
  };
};

export const deleteFlight = async (id: number) => {
  return await db.deleteFrom('flight').where('id', '=', id).executeTakeFirst();
};

export const updateFlight = async (id: number, data: CreateFlight) => {
  return await updateFlightPrimitive(db, id, data);
};

const signature = (f: CreateFlight) => {
  const firstLeg = f.legs[0];
  if (!firstLeg) return f.date;
  const from = firstLeg.from?.id ?? null;
  const to = firstLeg.to?.id ?? null;
  return [
    f.date ?? '',
    from ?? '',
    to ?? '',
    firstLeg.flightNumber ?? '',
    firstLeg.aircraftReg ?? '',
    firstLeg.departure ?? '',
    firstLeg.arrival ?? '',
    f.legs.length,
  ].join('|');
};

export const createManyFlights = async (
  data: CreateFlight[],
  userId: string,
  dedupe = true,
): Promise<{ insertedFlights: number; attachedSeats: number }> => {
  if (!dedupe) {
    const insertedFlights = data.length;
    const attachedSeats = data.reduce(
      (acc, f) => acc + f.legs.reduce((a, l) => a + (l.seats?.length ?? 0), 0),
      0,
    );
    await createManyFlightsPrimitive(db, data);
    return { insertedFlights, attachedSeats };
  }

  // Deduplicate within incoming data
  const uniqueMap = new Map<string, CreateFlight>();
  for (const f of data) {
    const key = signature(f);
    if (!uniqueMap.has(key)) uniqueMap.set(key, f);
  }
  const uniqueFlights = Array.from(uniqueMap.values());

  if (uniqueFlights.length === 0)
    return { insertedFlights: 0, attachedSeats: 0 };

  // Gather candidate filters from first leg
  const dates = new Set(uniqueFlights.map((f) => f.date));
  const froms = new Set(
    uniqueFlights
      .map((f) => f.legs[0]?.from?.id)
      .filter((id): id is number => !!id),
  );
  const tos = new Set(
    uniqueFlights
      .map((f) => f.legs[0]?.to?.id)
      .filter((id): id is number => !!id),
  );

  // Fetch existing flights for candidate space
  let existingFlights: Flight[] = [];

  if (dates.size && froms.size && tos.size) {
    const listQuery = listFlightsQuery(userId);
    existingFlights = await listQuery
      .where('date', 'in', Array.from(dates))
      .execute();

    // Filter to flights whose first leg matches from/to
    existingFlights = existingFlights.filter((ef) => {
      const firstLeg = ef.legs[0];
      if (!firstLeg) return false;
      return (
        froms.has(firstLeg.from?.id ?? -1) && tos.has(firstLeg.to?.id ?? -1)
      );
    });
  }

  const existingBySig = new Map<string, number>();
  for (const ef of existingFlights) {
    // Build signature from existing flight in CreateFlight-compatible shape
    const key = signature({
      date: ef.date,
      flightReason: ef.flightReason,
      note: ef.note,
      legs: ef.legs.map((l) => ({
        ...l,
        seats: l.seats.map((s) => ({
          userId: s.userId,
          guestName: s.guestName,
          seat: s.seat,
          seatNumber: s.seatNumber,
          seatClass: s.seatClass,
        })),
      })),
    });
    if (!existingBySig.has(key)) existingBySig.set(key, ef.id);
  }

  // Fetch user's existing seats among those flights (via leg -> seat join)
  const existingIds = Array.from(new Set(existingFlights.map((f) => f.id)));
  const userSeatByFlight = new Set<number>();
  if (existingIds.length) {
    const userSeats = await db
      .selectFrom('leg')
      .innerJoin('seat', 'seat.legId', 'leg.id')
      .select(['leg.flightId'])
      .where('seat.userId', '=', userId)
      .where('leg.flightId', 'in', existingIds)
      .execute();
    userSeats.forEach((s) => userSeatByFlight.add(s.flightId));
  }

  const flightsToInsert: CreateFlight[] = [];
  type SeatInsert = Insertable<DB['seat']>;
  const seatsToAttach: SeatInsert[] = [];

  for (const f of uniqueFlights) {
    const key = signature(f);
    const existingId = existingBySig.get(key);
    if (existingId) {
      // If user already has a seat on this flight, skip entirely
      if (userSeatByFlight.has(existingId)) {
        continue;
      }
      // Otherwise, attach incoming seats to existing flight's first leg
      const existingFlight = existingFlights.find(
        (ef) => ef.id === existingId,
      );
      const firstLegId = existingFlight?.legs[0]?.id;
      if (firstLegId) {
        for (const seat of f.legs[0]?.seats ?? []) {
          seatsToAttach.push({
            legId: firstLegId,
            userId: seat.userId,
            guestName: seat.guestName,
            seat: seat.seat,
            seatNumber: seat.seatNumber,
            seatClass: seat.seatClass,
          });
        }
      }
      continue;
    }
    flightsToInsert.push(f);
  }

  // Insert new flights and their seats
  let insertedFlights = 0;
  if (flightsToInsert.length) {
    await createManyFlightsPrimitive(db, flightsToInsert);
    insertedFlights = flightsToInsert.length;
  }

  // Attach seats to existing flights (dedup seats per user/leg)
  let attachedSeats = 0;
  if (seatsToAttach.length) {
    const seatKey = (s: { legId: number; userId: string | null }) =>
      `${s.legId}|${s.userId ?? ''}`;
    const uniqueSeatsMap = new Map<string, (typeof seatsToAttach)[number]>();
    for (const s of seatsToAttach) {
      const k = seatKey(s);
      if (!uniqueSeatsMap.has(k)) uniqueSeatsMap.set(k, s);
    }
    const uniqueSeats = Array.from(uniqueSeatsMap.values());
    if (uniqueSeats.length) {
      await db.insertInto('seat').values(uniqueSeats).execute();
      attachedSeats = uniqueSeats.length;
    }
  }

  return { insertedFlights, attachedSeats };
};
