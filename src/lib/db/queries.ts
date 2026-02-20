import { type Expression, type Kysely, sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';

import type { DB } from './schema';
import type { CreateFlight } from './types';

const airports = (
  db: Kysely<DB>,
  from: Expression<number>,
  to: Expression<number>,
) => {
  return [
    jsonObjectFrom(
      db.selectFrom('airport').where('airport.id', '=', from).selectAll(),
    ).as('from'),
    jsonObjectFrom(
      db.selectFrom('airport').where('airport.id', '=', to).selectAll(),
    ).as('to'),
  ];
};

const aircraft = (db: Kysely<DB>, id: Expression<number>) => {
  return jsonObjectFrom(
    db.selectFrom('aircraft').selectAll().where('aircraft.id', '=', id),
  ).as('aircraft');
};

const airline = (db: Kysely<DB>, id: Expression<number>) => {
  return jsonObjectFrom(
    db.selectFrom('airline').selectAll().where('airline.id', '=', id),
  ).as('airline');
};

export const listFlightBaseQuery = (db: Kysely<DB>, userId: string) => {
  return db
    .selectFrom('flight')
    .selectAll('flight')
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('leg')
          .selectAll('leg')
          .select((lb) =>
            airports(db, lb.ref('leg.fromId'), lb.ref('leg.toId')),
          )
          .select(({ ref }) => [aircraft(db, ref('leg.aircraftId'))])
          .select(({ ref }) => [airline(db, ref('leg.airlineId'))])
          .select((lb) => [
            jsonArrayFrom(
              lb
                .selectFrom('seat')
                .selectAll()
                .whereRef('seat.legId', '=', 'leg.id'),
            ).as('seats'),
          ])
          .whereRef('leg.flightId', '=', 'flight.id')
          .orderBy('leg.legOrder', 'asc'),
      ).as('legs'),
    ])
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('leg')
          .innerJoin('seat', 'seat.legId', 'leg.id')
          .select('leg.id')
          .whereRef('leg.flightId', '=', 'flight.id')
          .where('seat.userId', '=', userId),
      ),
    );
};

export const listFlightPrimitive = async (db: Kysely<DB>, userId: string) => {
  const listQuery = listFlightBaseQuery(db, userId);

  return await listQuery.execute();
};

export const getFlightPrimitive = async (db: Kysely<DB>, id: number) => {
  return await db
    .selectFrom('flight')
    .selectAll('flight')
    .select((eb) => [
      jsonArrayFrom(
        eb
          .selectFrom('leg')
          .selectAll('leg')
          .select((lb) =>
            airports(db, lb.ref('leg.fromId'), lb.ref('leg.toId')),
          )
          .select(({ ref }) => [aircraft(db, ref('leg.aircraftId'))])
          .select(({ ref }) => [airline(db, ref('leg.airlineId'))])
          .select((lb) => [
            jsonArrayFrom(
              lb
                .selectFrom('seat')
                .selectAll()
                .whereRef('seat.legId', '=', 'leg.id'),
            ).as('seats'),
          ])
          .whereRef('leg.flightId', '=', 'flight.id')
          .orderBy('leg.legOrder', 'asc'),
      ).as('legs'),
    ])
    .where('flight.id', '=', id)
    .executeTakeFirst();
};

export const createFlightPrimitive = async (
  db: Kysely<DB>,
  data: CreateFlight,
) => {
  return await db.transaction().execute(async (trx) => {
    const { legs, ...flightData } = data;

    const resp = await trx
      .insertInto('flight')
      .values(flightData)
      .returning('id')
      .executeTakeFirstOrThrow();

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]!;
      const { seats, from, to, aircraft, airline, ...legData } = leg;
      const fromId = from?.id ?? null;
      const toId = to?.id ?? null;
      const aircraftId = aircraft?.id ?? null;
      const airlineId = airline?.id ?? null;

      const legResp = await trx
        .insertInto('leg')
        .values({
          ...legData,
          flightId: resp.id,
          legOrder: i,
          fromId,
          toId,
          aircraftId,
          airlineId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (seats.length) {
        const seatData = seats.map((seat) => ({
          legId: legResp.id,
          userId: seat.userId,
          guestName: seat.guestName,
          seat: seat.seat,
          seatNumber: seat.seatNumber,
          seatClass: seat.seatClass,
        }));

        await trx.insertInto('seat').values(seatData).executeTakeFirstOrThrow();
      }
    }

    return resp.id;
  });
};

export const updateFlightPrimitive = async (
  db: Kysely<DB>,
  id: number,
  data: CreateFlight,
) => {
  await db.transaction().execute(async (trx) => {
    const { legs, ...flightData } = data;

    await trx
      .updateTable('flight')
      .set(flightData)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    // Delete all existing legs (cascade deletes seats)
    await trx.deleteFrom('leg').where('flightId', '=', id).execute();

    // Re-insert legs and seats
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]!;
      const { seats, from, to, aircraft, airline, ...legData } = leg;
      const fromId = from?.id ?? null;
      const toId = to?.id ?? null;
      const aircraftId = aircraft?.id ?? null;
      const airlineId = airline?.id ?? null;

      const legResp = await trx
        .insertInto('leg')
        .values({
          ...legData,
          flightId: id,
          legOrder: i,
          fromId,
          toId,
          aircraftId,
          airlineId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (seats.length) {
        const seatData = seats.map((seat) => ({
          legId: legResp.id,
          userId: seat.userId,
          guestName: seat.guestName,
          seat: seat.seat,
          seatNumber: seat.seatNumber,
          seatClass: seat.seatClass,
        }));

        await trx.insertInto('seat').values(seatData).executeTakeFirstOrThrow();
      }
    }
  });
};

export const createManyFlightsPrimitive = async (
  db: Kysely<DB>,
  data: CreateFlight[],
) => {
  await db.transaction().execute(async (trx) => {
    for (const flight of data) {
      const { legs, ...flightData } = flight;

      const resp = await trx
        .insertInto('flight')
        .values(flightData)
        .returning('id')
        .executeTakeFirstOrThrow();

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i]!;
        const { seats, from, to, aircraft, airline, ...legData } = leg;

        const legResp = await trx
          .insertInto('leg')
          .values({
            ...legData,
            flightId: resp.id,
            legOrder: i,
            fromId: from?.id ?? null,
            toId: to?.id ?? null,
            aircraftId: aircraft?.id ?? null,
            airlineId: airline?.id ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        if (seats.length) {
          const seatData = seats.map((seat) => ({
            legId: legResp.id,
            userId: seat.userId,
            guestName: seat.guestName,
            seat: seat.seat,
            seatNumber: seat.seatNumber,
            seatClass: seat.seatClass,
          }));

          await trx.insertInto('seat').values(seatData).execute();
        }
      }
    }
  });
};

export const findAirportsPrimitive = async (db: Kysely<DB>, input: string) => {
  const namePattern = `%${input}%`;
  return await db
    .selectFrom('airport')
    .selectAll()
    .where((qb) =>
      qb.or([
        qb('icao', 'ilike', input),
        qb('iata', 'ilike', input),
        sql<boolean>`unaccent("name") ILIKE unaccent(${namePattern})` as any,
      ]),
    )
    .select([
      sql`CASE
              WHEN "icao" ILIKE ${input} THEN 1
              WHEN "iata" ILIKE ${input} THEN 1
              WHEN unaccent("name") ILIKE unaccent(${namePattern}) THEN 2
              ELSE 3
            END`.as('match_rank'),
      sql`CASE
            WHEN "type" = 'closed' THEN 7
            WHEN "type" = 'heliport' THEN 6
            WHEN "type" = 'balloonport' THEN 5
            WHEN "type" = 'seaplane_base' THEN 4
            WHEN "type" = 'small_airport' THEN 3
            WHEN "type" = 'medium_airport' THEN 2
            WHEN "type" = 'large_airport' THEN 1
            ELSE 8
          END`.as('type_rank'),
    ])
    .orderBy('match_rank', 'asc')
    .orderBy('type_rank', 'asc')
    .limit(10)
    .execute();
};
