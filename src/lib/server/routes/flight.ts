import { parseISO } from 'date-fns';
import { z } from 'zod';

import { authedProcedure, router } from '../trpc';

import { db } from '$lib/db';
import type { CreateFlight } from '$lib/db/types';
import {
  createFlight,
  createManyFlights,
  deleteFlight,
  listFlights,
} from '$lib/server/utils/flight';
import { getFlightRoute } from '$lib/server/utils/flight-lookup/flight-lookup';
import { generateCsv } from '$lib/utils/csv';
import { omit } from '$lib/utils/other';

export const flightRouter = router({
  lookup: authedProcedure
    .input(
      z.object({
        flightNumber: z.string(),
        date: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .query(async ({ input }) => {
      const results = await getFlightRoute(
        input.flightNumber,
        // @ts-expect-error - We know the date string is a full ISO datetime string
        input.date ? { date: parseISO(input.date.split('T')[0]) } : undefined,
      );

      // The below mess is required to maintain timezone through serialization
      return results.map((r) => ({
        ...r,
        departure: r.departure ? r.departure.toISOString() : null,
        departureTz: r.departure ? r.departure.timeZone : null,
        arrival: r.arrival ? r.arrival.toISOString() : null,
        arrivalTz: r.arrival ? r.arrival.timeZone : null,
        departureScheduled: r.departureScheduled
          ? r.departureScheduled.toISOString()
          : null,
        arrivalScheduled: r.arrivalScheduled
          ? r.arrivalScheduled.toISOString()
          : null,
      }));
    }),
  list: authedProcedure.query(async ({ ctx: { user } }) => {
    return await listFlights(user.id);
  }),
  delete: authedProcedure
    .input(z.number())
    .mutation(async ({ ctx: { user }, input }) => {
      // Check seat ownership via leg -> seat join
      const seats = await db
        .selectFrom('leg')
        .innerJoin('seat', 'seat.legId', 'leg.id')
        .selectAll('seat')
        .where('leg.flightId', '=', input)
        .execute();

      if (!seats.some((seat) => seat.userId === user.id)) {
        throw new Error('You do not have a seat on this flight');
      }

      const resp = await deleteFlight(input);

      if (!resp.numDeletedRows) {
        throw new Error('Flight not found');
      }
    }),
  deleteMany: authedProcedure
    .input(z.array(z.number()))
    .mutation(async ({ ctx: { user }, input }) => {
      const result = await db
        .selectFrom('leg')
        .innerJoin('seat', 'seat.legId', 'leg.id')
        .select('leg.flightId')
        .distinct()
        .where('seat.userId', '=', user.id)
        .where('leg.flightId', 'in', input)
        .execute();
      const flightIds = result.map((r) => r.flightId);

      if (flightIds.length !== input.length) {
        throw new Error('You do not have a seat on all flights');
      }

      await db.deleteFrom('flight').where('id', 'in', input).execute();
    }),
  deleteAll: authedProcedure.mutation(async ({ ctx: { user } }) => {
    const flightIds = await db
      .selectFrom('flight')
      .innerJoin('leg', 'leg.flightId', 'flight.id')
      .innerJoin('seat', 'seat.legId', 'leg.id')
      .select('flight.id')
      .groupBy('flight.id')
      .having((eb) =>
        eb.and([
          eb(
            eb.fn.count(
              eb
                .case()
                .when('seat.userId', '=', user.id)
                .then(1)
                .else(null)
                .end(),
            ),
            '=',
            1,
          ),
          eb(
            eb.fn.count(
              eb
                .case()
                .when('seat.userId', 'is', null)
                .then(1)
                .else(null)
                .end(),
            ),
            '=',
            eb(eb.fn.count('seat.id'), '-', eb.lit(1)),
          ),
        ]),
      )
      .execute();

    if (flightIds.length === 0) {
      return;
    }

    const idsToDelete = flightIds.map((f) => f.id);
    await db.deleteFrom('flight').where('id', 'in', idsToDelete).execute();
  }),
  create: authedProcedure
    .input(z.custom<CreateFlight>())
    .mutation(async ({ input }) => {
      await createFlight(input);
    }),
  createMany: authedProcedure
    .input(
      z.object({
        flights: z.custom<CreateFlight[]>(),
        dedupe: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx: { user }, input }) => {
      return await createManyFlights(
        input.flights,
        user.id,
        input.dedupe ?? true,
      );
    }),
  exportJson: authedProcedure.query(async ({ ctx: { user } }) => {
    const users = await db
      .selectFrom('user')
      .select(['id', 'displayName', 'username'])
      .execute();
    const res = await listFlights(user.id);
    const flights = res.map((flight) => ({
      ...omit(flight, ['id']),
      legs: flight.legs.map((leg) => ({
        ...omit(leg, ['id', 'legOrder', 'fromId', 'toId', 'airlineId', 'aircraftId']),
        from: leg.from ? omit(leg.from, ['id']) : null,
        to: leg.to ? omit(leg.to, ['id']) : null,
        airline: leg.airline ? omit(leg.airline, ['id']) : null,
        aircraft: leg.aircraft ? omit(leg.aircraft, ['id']) : null,
        seats: leg.seats.map((seat) => omit(seat, ['id', 'legId'])),
      })),
    }));
    return JSON.stringify(
      {
        version: 2,
        users,
        flights,
      },
      null,
      2,
    );
  }),
  exportCsv: authedProcedure.query(async ({ ctx: { user } }) => {
    const res = await listFlights(user.id);
    const rows = res.flatMap((flight) =>
      flight.legs.map((leg, legIndex) => {
        const seat = leg.seats.find((seat) => seat.userId === user.id);
        return {
          flightId: flight.id,
          legOrder: legIndex,
          date: flight.date,
          flightReason: flight.flightReason,
          note: flight.note,
          from: leg.from?.name,
          to: leg.to?.name,
          departure: leg.departure,
          arrival: leg.arrival,
          duration: leg.duration,
          flightNumber: leg.flightNumber,
          aircraftReg: leg.aircraftReg,
          airline: leg.airline?.name,
          aircraft: leg.aircraft?.name,
          seat: seat?.seat,
          seatNumber: seat?.seatNumber,
          seatClass: seat?.seatClass,
        };
      }),
    );

    return generateCsv(rows);
  }),
});
