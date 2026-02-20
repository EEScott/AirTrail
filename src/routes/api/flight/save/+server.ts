import { json } from '@sveltejs/kit';
import { z } from 'zod';

import type { RequestHandler } from './$types';

import { getAircraftByIcao } from '$lib/server/utils/aircraft';
import { getAirlineByIcao } from '$lib/server/utils/airline';
import { getAirportByIcao } from '$lib/server/utils/airport';
import { apiError, unauthorized, validateApiKey } from '$lib/server/utils/api';
import { validateAndSaveFlight } from '$lib/server/utils/flight';
import { aircraftSchema } from '$lib/zod/aircraft';
import { airlineSchema } from '$lib/zod/airline';
import { flightSchema, legSchema } from '$lib/zod/flight';

const defaultLeg = {
  arrival: null,
  arrivalScheduled: null,
  departureTime: null,
  arrivalTime: null,
  departureScheduled: null,
  departureScheduledTime: null,
  arrivalScheduledTime: null,
  takeoffScheduled: null,
  takeoffScheduledTime: null,
  takeoffActual: null,
  takeoffActualTime: null,
  landingScheduled: null,
  landingScheduledTime: null,
  landingActual: null,
  landingActualTime: null,
  airline: null,
  flightNumber: null,
  aircraft: null,
  aircraftReg: null,
};

const defaultSeat = {
  guestName: null,
  seat: null,
  seatNumber: null,
  seatClass: null,
};

// API schema for a single leg with ICAO string references
const saveApiLegSchema = legSchema.merge(
  z.object({
    from: z.string(),
    to: z.string(),
    aircraft: aircraftSchema.shape.icao,
    airline: airlineSchema.shape.icao,
  }),
);

// Full API schema — legs array, or flat leg for backwards compat
const saveApiFlightSchema = z.union([
  // New format: flight with legs array
  z.object({
    flightReason: flightSchema.shape.flightReason,
    note: flightSchema.shape.note,
    legs: z.array(saveApiLegSchema).min(1),
  }),
  // Legacy flat format: single leg fields at top level
  saveApiLegSchema.merge(
    z.object({
      flightReason: flightSchema.shape.flightReason,
      note: flightSchema.shape.note,
    }),
  ),
]);

const dateTimeSchema = z.string().datetime({ offset: true });

function fillLegDefaults(raw: any) {
  const filled = {
    ...defaultLeg,
    ...raw,
    seats: (raw.seats ?? []).map((s: any) => ({ ...defaultSeat, ...s })),
  };
  filled.departure = dateTimeSchema.safeParse(filled.departure).success
    ? filled.departure
    : filled.departure
      ? filled.departure + 'T10:00:00.000+00:00'
      : null;
  filled.arrival = dateTimeSchema.safeParse(filled.arrival).success
    ? filled.arrival
    : filled.arrival
      ? filled.arrival + 'T10:00:00.000+00:00'
      : null;
  return filled;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();

  // Normalize: if body has flat from/to (no legs), wrap into legs[0]
  let normalized: any;
  if (body.legs && Array.isArray(body.legs)) {
    normalized = {
      ...body,
      legs: body.legs.map(fillLegDefaults),
    };
  } else {
    // Legacy flat format
    const legData = fillLegDefaults(body);
    normalized = {
      flightReason: body.flightReason ?? null,
      note: body.note ?? null,
      legs: [legData],
    };
  }

  const parsed = saveApiFlightSchema.safeParse(normalized);
  if (!parsed.success) {
    return json(
      { success: false, errors: parsed.error.errors },
      { status: 400 },
    );
  }

  const user = await validateApiKey(request);
  if (!user) {
    return unauthorized();
  }

  // Resolve legs
  const legs: any[] = [];
  const rawLegs = 'legs' in parsed.data ? parsed.data.legs : [parsed.data];
  for (const rawLeg of rawLegs) {
    const from = await getAirportByIcao(rawLeg.from as string);
    if (!from) {
      return apiError(`Invalid departure airport: ${rawLeg.from}`);
    }

    const to = await getAirportByIcao(rawLeg.to as string);
    if (!to) {
      return apiError(`Invalid arrival airport: ${rawLeg.to}`);
    }

    let aircraft;
    if (rawLeg.aircraft) {
      aircraft = await getAircraftByIcao(rawLeg.aircraft as string);
      if (!aircraft) {
        return apiError(`Invalid aircraft: ${rawLeg.aircraft}`);
      }
    }

    let airline;
    if (rawLeg.airline) {
      airline = await getAirlineByIcao(rawLeg.airline as string);
      if (!airline) {
        return apiError(`Invalid airline: ${rawLeg.airline}`);
      }
    }

    const legData = {
      ...rawLeg,
      from,
      to,
      aircraft: aircraft ?? null,
      airline: airline ?? null,
    };

    if (legData.seats[0]?.userId === '<USER_ID>') {
      legData.seats[0].userId = user.id;
    }

    legs.push(legData);
  }

  const flightReason =
    'flightReason' in parsed.data ? parsed.data.flightReason : null;
  const note = 'note' in parsed.data ? parsed.data.note : null;

  const data = {
    flightReason,
    note,
    legs,
  };

  const result = await validateAndSaveFlight(user, data);
  if (!result.success) {
    // @ts-expect-error - this should be valid
    return apiError(result.message, result.status || 500);
  }

  return json({ success: true, ...(result.id && { id: result.id }) });
};
