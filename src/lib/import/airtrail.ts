import { z } from 'zod';

import { page } from '$app/state';
import type { PlatformOptions } from '$lib/components/modals/settings/pages/import-page';
import type { CreateFlight, CreateLeg } from '$lib/db/types';
import { FlightReasons, SeatClasses, SeatTypes } from '$lib/db/types';
import { api } from '$lib/trpc';
import { getAircraftByIcao, getAircraftByName } from '$lib/utils/data/aircraft';
import { getAirlineByIcao, getAirlineByName } from '$lib/utils/data/airlines';
import { getAirportByIcao } from '$lib/utils/data/airports/cache';
import { aircraftSchema } from '$lib/zod/aircraft';
import { airlineSchema } from '$lib/zod/airline';
import { flightAirportSchema } from '$lib/zod/airport';

const dateTimePrimitive = z.string().datetime({ offset: true }).nullable();

const usersSchema = z
  .object({
    id: z.string().min(3),
    username: z
      .string()
      .min(3, { message: 'Username must be at least 3 characters long' })
      .max(20, { message: 'Username must be at most 20 characters long' })
      .regex(/^\w+$/, {
        message:
          'Username can only contain letters, numbers, and underscores',
      }),
    displayName: z.string().min(3),
  })
  .array()
  .min(1, 'At least one user is required');

const seatSchema = z
  .object({
    userId: z.string().nullable(),
    guestName: z.string().max(50, 'Guest name is too long').nullable(),
    seat: z.enum(SeatTypes).nullable(),
    seatNumber: z.string().max(5, 'Seat number is too long').nullable(),
    seatClass: z.enum(SeatClasses).nullable(),
  })
  .refine((data) => data.userId ?? data.guestName, {
    message: 'Select a user or add a guest name',
    path: ['userId'],
  })
  .array()
  .min(1, 'Add at least one seat')
  .refine((data) => data.some((seat) => seat.userId), {
    message: 'At least one seat must be assigned to a user',
  })
  .default([
    {
      userId: '<USER_ID>',
      guestName: null,
      seat: null,
      seatNumber: null,
      seatClass: null,
    },
  ]);

// V1 schema: flat flights (no version field)
const AirTrailFileV1 = z.object({
  flights: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      from: flightAirportSchema.omit({ id: true }),
      to: flightAirportSchema.omit({ id: true }),
      departure: z
        .string()
        .datetime({ offset: true, message: 'Invalid datetime' })
        .nullable(),
      arrival: z
        .string()
        .datetime({ offset: true, message: 'Invalid datetime' })
        .nullable(),
      departureScheduled: dateTimePrimitive,
      arrivalScheduled: dateTimePrimitive,
      takeoffScheduled: dateTimePrimitive,
      takeoffActual: dateTimePrimitive,
      landingScheduled: dateTimePrimitive,
      landingActual: dateTimePrimitive,
      duration: z.number().int().positive().nullable(),
      airline: airlineSchema.omit({ id: true }).nullable(),
      aircraft: aircraftSchema.omit({ id: true }).nullable(),
      flightNumber: z.string().max(10, 'Flight number is too long').nullable(),
      aircraftReg: z
        .string()
        .max(10, 'Aircraft registration is too long')
        .nullable(),
      flightReason: z.enum(FlightReasons).nullable(),
      note: z.string().max(1000, 'Note is too long').nullable(),
      departureTerminal: z.string().max(10).nullable().optional(),
      departureGate: z.string().max(10).nullable().optional(),
      arrivalTerminal: z.string().max(10).nullable().optional(),
      arrivalGate: z.string().max(10).nullable().optional(),
      seats: seatSchema,
    })
    .array()
    .min(1, 'At least one flight is required'),
  users: usersSchema,
});

// V2 schema: flights with legs array
const legSchemaImport = z.object({
  from: flightAirportSchema.omit({ id: true }).nullable(),
  to: flightAirportSchema.omit({ id: true }).nullable(),
  departure: dateTimePrimitive,
  arrival: dateTimePrimitive,
  departureScheduled: dateTimePrimitive,
  arrivalScheduled: dateTimePrimitive,
  takeoffScheduled: dateTimePrimitive,
  takeoffActual: dateTimePrimitive,
  landingScheduled: dateTimePrimitive,
  landingActual: dateTimePrimitive,
  duration: z.number().int().positive().nullable(),
  flightNumber: z.string().max(10).nullable(),
  aircraftReg: z.string().max(10).nullable(),
  airline: airlineSchema.omit({ id: true }).nullable(),
  aircraft: aircraftSchema.omit({ id: true }).nullable(),
  departureTerminal: z.string().max(10).nullable().optional(),
  departureGate: z.string().max(10).nullable().optional(),
  arrivalTerminal: z.string().max(10).nullable().optional(),
  arrivalGate: z.string().max(10).nullable().optional(),
  seats: seatSchema,
});

const AirTrailFileV2 = z.object({
  version: z.literal(2),
  flights: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      flightReason: z.enum(FlightReasons).nullable(),
      note: z.string().max(1000, 'Note is too long').nullable(),
      legs: z.array(legSchemaImport).min(1),
    })
    .array()
    .min(1, 'At least one flight is required'),
  users: usersSchema,
});

type ResolvedUsers = Awaited<ReturnType<typeof api.user.list.query>>;
type DataUsers = Record<
  string,
  { id: string; username: string; displayName: string }
>;
type ExportedUser = {
  id: string;
  username: string;
  displayName: string;
  mappedUserId: string | null;
};

const resolveSeats = (
  rawSeats: z.infer<typeof seatSchema>,
  dataUsers: DataUsers,
  exportedUsers: ExportedUser[],
  users: ResolvedUsers,
  currentUser: { id: string; username: string },
  flightIndex: number,
  unknownUsers: Record<string, number[]>,
) => {
  const seats = rawSeats.map((seat) => {
    const dataUser = dataUsers?.[seat.userId ?? ''];
    const mappedUserId = dataUser
      ? exportedUsers.find((u) => u.id === dataUser.id)?.mappedUserId
      : null;
    const user = mappedUserId
      ? users.find((user) => user.id === mappedUserId)
      : null;

    if (dataUser && !user) {
      const key = `${dataUser.id}|${dataUser.username}|${dataUser.displayName}`;
      if (!unknownUsers[key]) unknownUsers[key] = [];
      unknownUsers[key].push(flightIndex);
    }

    const guestName = user
      ? null
      : seat.guestName
        ? seat.guestName
        : dataUser
          ? dataUser.displayName
          : null;

    return {
      ...seat,
      userId: user?.id ?? null,
      guestName,
    };
  });

  // If exported with a different username, add the user to the list manually.
  if (
    !seats.some(
      (seat) =>
        users.find((usr) => usr.id === seat.userId)?.username ===
        currentUser.username,
    )
  ) {
    seats.push({
      userId: currentUser.id,
      guestName: null,
      seat: null,
      seatClass: null,
      seatNumber: null,
    });
  }

  return seats;
};

const resolveAirline = async (
  rawAirline: { name: string; icao: string | null; iata: string | null } | null,
  options: PlatformOptions,
) => {
  if (!rawAirline) return null;
  const mappedAirline = rawAirline.icao
    ? options.airlineMapping?.[rawAirline.icao]
    : undefined;
  return (
    mappedAirline ||
    (rawAirline.icao
      ? await getAirlineByIcao(rawAirline.icao)
      : await getAirlineByName(rawAirline.name))
  );
};

const resolveAircraft = async (
  rawAircraft: { name: string; icao: string | null } | null,
) => {
  if (!rawAircraft) return null;
  return rawAircraft.icao
    ? await getAircraftByIcao(rawAircraft.icao)
    : await getAircraftByName(rawAircraft.name);
};

export const processAirTrailFile = async (
  input: string,
  options: PlatformOptions,
) => {
  const user = page.data.user;
  if (!user) {
    throw new Error('User not found');
  }

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (_) {
    throw new Error('Invalid JSON found in AirTrail file');
  }

  // Detect version and parse accordingly
  const isV2 = parsed?.version === 2;

  if (isV2) {
    const result = AirTrailFileV2.safeParse(parsed);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return await processV2(result.data, options, user);
  } else {
    const result = AirTrailFileV1.safeParse(parsed);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return await processV1(result.data, options, user);
  }
};

async function processV1(
  data: z.infer<typeof AirTrailFileV1>,
  options: PlatformOptions,
  currentUser: { id: string; username: string },
) {
  const dataUsers = data.users.reduce<DataUsers>((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {});
  const users = await api.user.list.query();

  const exportedUsers = data.users.map((exportedUser) => {
    const mappedUserId =
      options.userMapping?.[exportedUser.id] ??
      users.find((user) => user.username === exportedUser.username)?.id ??
      null;

    return {
      id: exportedUser.id,
      username: exportedUser.username,
      displayName: exportedUser.displayName,
      mappedUserId,
    };
  });

  const flights: CreateFlight[] = [];
  const unknownAirports: Record<string, number[]> = {};
  const unknownAirlines: Record<string, number[]> = {};
  const unknownUsers: Record<string, number[]> = {};

  for (const rawFlight of data.flights) {
    const flightIndex = flights.length;

    const seats = resolveSeats(
      rawFlight.seats,
      dataUsers,
      exportedUsers,
      users,
      currentUser,
      flightIndex,
      unknownUsers,
    );

    const mappedFrom = options.airportMapping?.[rawFlight.from.icao];
    const mappedTo = options.airportMapping?.[rawFlight.to.icao];
    const from = mappedFrom ?? (await getAirportByIcao(rawFlight.from.icao));
    const to = mappedTo ?? (await getAirportByIcao(rawFlight.to.icao));

    const airline = await resolveAirline(rawFlight.airline, options);
    const aircraft = await resolveAircraft(rawFlight.aircraft);

    if (!from) {
      if (!unknownAirports[rawFlight.from.icao])
        unknownAirports[rawFlight.from.icao] = [];
      unknownAirports[rawFlight.from.icao].push(flightIndex);
    }
    if (!to) {
      if (!unknownAirports[rawFlight.to.icao])
        unknownAirports[rawFlight.to.icao] = [];
      unknownAirports[rawFlight.to.icao].push(flightIndex);
    }
    if (!airline && rawFlight.airline?.icao) {
      const code = rawFlight.airline.icao;
      if (!unknownAirlines[code]) unknownAirlines[code] = [];
      unknownAirlines[code].push(flightIndex);
    }

    flights.push({
      date: rawFlight.date,
      flightReason: rawFlight.flightReason ?? null,
      note: rawFlight.note ?? null,
      legs: [
        {
          from: from || null,
          to: to || null,
          departure: rawFlight.departure,
          arrival: rawFlight.arrival,
          departureScheduled: rawFlight.departureScheduled ?? null,
          arrivalScheduled: rawFlight.arrivalScheduled ?? null,
          takeoffScheduled: rawFlight.takeoffScheduled ?? null,
          takeoffActual: rawFlight.takeoffActual ?? null,
          landingScheduled: rawFlight.landingScheduled ?? null,
          landingActual: rawFlight.landingActual ?? null,
          departureTerminal: rawFlight.departureTerminal ?? null,
          departureGate: rawFlight.departureGate ?? null,
          arrivalTerminal: rawFlight.arrivalTerminal ?? null,
          arrivalGate: rawFlight.arrivalGate ?? null,
          duration: rawFlight.duration,
          flightNumber: rawFlight.flightNumber,
          airline,
          aircraft,
          aircraftReg: rawFlight.aircraftReg,
          seats,
        },
      ],
    });
  }

  return {
    flights,
    unknownAirports,
    unknownAirlines,
    unknownUsers,
    exportedUsers,
  };
}

async function processV2(
  data: z.infer<typeof AirTrailFileV2>,
  options: PlatformOptions,
  currentUser: { id: string; username: string },
) {
  const dataUsers = data.users.reduce<DataUsers>((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {});
  const users = await api.user.list.query();

  const exportedUsers = data.users.map((exportedUser) => {
    const mappedUserId =
      options.userMapping?.[exportedUser.id] ??
      users.find((user) => user.username === exportedUser.username)?.id ??
      null;

    return {
      id: exportedUser.id,
      username: exportedUser.username,
      displayName: exportedUser.displayName,
      mappedUserId,
    };
  });

  const flights: CreateFlight[] = [];
  const unknownAirports: Record<string, number[]> = {};
  const unknownAirlines: Record<string, number[]> = {};
  const unknownUsers: Record<string, number[]> = {};

  for (const rawFlight of data.flights) {
    const flightIndex = flights.length;
    const processedLegs: CreateLeg[] = [];

    for (const rawLeg of rawFlight.legs) {
      const seats = resolveSeats(
        rawLeg.seats,
        dataUsers,
        exportedUsers,
        users,
        currentUser,
        flightIndex,
        unknownUsers,
      );

      const fromIcao = rawLeg.from?.icao;
      const toIcao = rawLeg.to?.icao;

      const mappedFrom = fromIcao
        ? options.airportMapping?.[fromIcao]
        : undefined;
      const mappedTo = toIcao ? options.airportMapping?.[toIcao] : undefined;
      const from = mappedFrom ?? (fromIcao ? await getAirportByIcao(fromIcao) : null);
      const to = mappedTo ?? (toIcao ? await getAirportByIcao(toIcao) : null);

      const airline = await resolveAirline(rawLeg.airline, options);
      const aircraft = await resolveAircraft(rawLeg.aircraft);

      if (!from && fromIcao) {
        if (!unknownAirports[fromIcao]) unknownAirports[fromIcao] = [];
        unknownAirports[fromIcao].push(flightIndex);
      }
      if (!to && toIcao) {
        if (!unknownAirports[toIcao]) unknownAirports[toIcao] = [];
        unknownAirports[toIcao].push(flightIndex);
      }
      if (!airline && rawLeg.airline?.icao) {
        const code = rawLeg.airline.icao;
        if (!unknownAirlines[code]) unknownAirlines[code] = [];
        unknownAirlines[code].push(flightIndex);
      }

      processedLegs.push({
        from: from || null,
        to: to || null,
        departure: rawLeg.departure,
        arrival: rawLeg.arrival,
        departureScheduled: rawLeg.departureScheduled ?? null,
        arrivalScheduled: rawLeg.arrivalScheduled ?? null,
        takeoffScheduled: rawLeg.takeoffScheduled ?? null,
        takeoffActual: rawLeg.takeoffActual ?? null,
        landingScheduled: rawLeg.landingScheduled ?? null,
        landingActual: rawLeg.landingActual ?? null,
        departureTerminal: rawLeg.departureTerminal ?? null,
        departureGate: rawLeg.departureGate ?? null,
        arrivalTerminal: rawLeg.arrivalTerminal ?? null,
        arrivalGate: rawLeg.arrivalGate ?? null,
        duration: rawLeg.duration,
        flightNumber: rawLeg.flightNumber,
        airline,
        aircraft,
        aircraftReg: rawLeg.aircraftReg,
        seats,
      });
    }

    flights.push({
      date: rawFlight.date,
      flightReason: rawFlight.flightReason,
      note: rawFlight.note,
      legs: processedLegs,
    });
  }

  return {
    flights,
    unknownAirports,
    unknownAirlines,
    unknownUsers,
    exportedUsers,
  };
}
