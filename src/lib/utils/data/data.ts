import { TZDate } from '@date-fns/tz';
import { isAfter } from 'date-fns';

import { page } from '$app/state';
import type { Airport, Flight, Leg } from '$lib/db/types';
import { distanceBetween, toTitleCase } from '$lib/utils';
import { nowIn, parseLocalISO, parseLocalizeISO } from '$lib/utils/datetime';

export type LegData = {
  from: Airport | null;
  to: Airport | null;
  departure: TZDate | null;
  arrival: TZDate | null;
  distance: number | null;
  duration: number | null;
  seats: Leg['seats'];
  airline: Leg['airline'];
  aircraft: Leg['aircraft'];
  aircraftReg: string | null;
  flightNumber: string | null;
  legOrder: number;
  raw: Leg;
};

type FlightOverrides = {
  date: TZDate | null;
  departure: TZDate | null;
  arrival: TZDate | null;
  distance: number | null;
  raw: Flight;
  legs: LegData[];
  // First-leg convenience accessors
  from: Airport | null;
  to: Airport | null;
  seats: Leg['seats'];
  airline: Leg['airline'];
  aircraft: Leg['aircraft'];
  aircraftReg: string | null;
  flightNumber: string | null;
  duration: number | null;
};

type ExcludedType<T, U> = {
  [P in keyof T as P extends keyof U ? never : P]: T[P];
};

export type FlightData = ExcludedType<Flight, FlightOverrides> &
  FlightOverrides;

const processLeg = (leg: Leg): LegData => {
  const departure =
    leg.departure && leg.from
      ? parseLocalizeISO(leg.departure, leg.from.tz)
      : leg.departure
        ? parseLocalizeISO(leg.departure, 'UTC')
        : null;

  const arrival =
    leg.arrival && leg.to
      ? parseLocalizeISO(leg.arrival, leg.to.tz)
      : leg.arrival
        ? parseLocalizeISO(leg.arrival, 'UTC')
        : null;

  const distance =
    leg.from && leg.to
      ? distanceBetween(
          [leg.from.lon, leg.from.lat],
          [leg.to.lon, leg.to.lat],
        ) / 1000
      : null;

  return {
    from: leg.from,
    to: leg.to,
    departure,
    arrival,
    distance,
    duration: leg.duration,
    seats: leg.seats,
    airline: leg.airline,
    aircraft: leg.aircraft,
    aircraftReg: leg.aircraftReg,
    flightNumber: leg.flightNumber,
    legOrder: leg.legOrder,
    raw: leg,
  };
};

export const prepareFlightData = (data: Flight[]): FlightData[] => {
  if (!data) return [];

  return data
    .map((flight) => {
      const legs = flight.legs.map(processLeg);
      const firstLeg = legs[0];

      const departure = firstLeg?.departure ?? null;
      const firstRawLeg = flight.legs[0];

      return {
        ...flight,
        date:
          departure ??
          (flight.date && firstRawLeg?.from
            ? parseLocalISO(`${flight.date}T00:00`, firstRawLeg.from.tz)
            : flight.date
              ? parseLocalISO(`${flight.date}T00:00`, 'UTC')
              : null),
        departure,
        arrival: legs[legs.length - 1]?.arrival ?? null,
        distance: firstLeg?.distance ?? null,
        raw: flight,
        legs,
        // First-leg convenience accessors
        from: firstLeg?.from ?? null,
        to: legs[legs.length - 1]?.to ?? null,
        seats: firstLeg?.seats ?? [],
        airline: firstLeg?.airline ?? null,
        aircraft: firstLeg?.aircraft ?? null,
        aircraftReg: firstLeg?.aircraftReg ?? null,
        flightNumber: firstLeg?.flightNumber ?? null,
        duration: legs.reduce((sum, l) => sum + (l.duration ?? 0), 0) || null,
      };
    })
    .filter((f) => f !== null);
};

export const prepareFlightArcData = (data: FlightData[]) => {
  if (!data) return [];

  const routeMap: {
    [key: string]: {
      distance: number;
      from: Airport;
      to: Airport;
      flights: ReturnType<typeof formatSimpleFlight>[];
      airlines: number[];
      exclusivelyFuture: boolean;
    };
  } = {};

  data.forEach((flight) => {
    // Create arcs for each leg
    for (const leg of flight.legs) {
      if (!leg.from || !leg.to) continue;

      const key = [leg.from.name, leg.to.name]
        .sort((a, b) => a.localeCompare(b))
        .join('-');
      if (!routeMap[key]) {
        routeMap[key] = {
          distance: leg.distance!,
          from: leg.from,
          to: leg.to,
          flights: [],
          airlines: [],
          exclusivelyFuture: false,
        };
      }

      routeMap[key].flights.push(formatSimpleFlight(flight));

      if (
        routeMap[key].flights.every(
          (f) => f.date && isAfter(f.date, nowIn('UTC')),
        )
      ) {
        routeMap[key].exclusivelyFuture = true;
      }

      if (leg.airline) {
        if (!routeMap[key].airlines.includes(leg.airline.id)) {
          routeMap[key].airlines.push(leg.airline.id);
        }
      }
    }
  });

  return Object.values(routeMap);
};

export const prepareVisitedAirports = (data: FlightData[]) => {
  const visited: (Airport & {
    arrivals: number;
    departures: number;
    airlines: number[];
    flights: ReturnType<typeof formatSimpleFlight>[];
    frequency: number;
  })[] = [];
  const formatAirport = (
    flight: FlightData,
    leg: LegData,
    direction: 'from' | 'to',
  ) => {
    if (!leg[direction]) return;

    const airport = leg[direction];
    let visit = visited.find((v) => v.name === airport.name);
    if (!visit) {
      visit = {
        ...airport,
        arrivals: 0,
        departures: 0,
        airlines: [],
        flights: [],
        frequency: 0,
      };
      visited.push(visit);
    }

    if (direction === 'from') {
      visit.departures++;
    } else {
      visit.arrivals++;
    }

    if (leg.airline && !visit.airlines.includes(leg.airline.id)) {
      visit.airlines.push(leg.airline.id);
    }

    visit.flights.push(formatSimpleFlight(flight));
  };

  data.forEach((flight) => {
    for (const leg of flight.legs) {
      formatAirport(flight, leg, 'from');
      formatAirport(flight, leg, 'to');
    }
  });

  const MIN_FREQUENCY = 1;
  const MAX_FREQUENCY = 3;

  const combinedFrequencies = visited.map((v) => v.arrivals + v.departures);

  const rawMin = Math.min(...combinedFrequencies);
  const rawMax = Math.max(...combinedFrequencies);

  const span = rawMax - rawMin || 1;

  visited.forEach((v) => {
    const combined = v.arrivals + v.departures;

    const normalised = (combined - rawMin) / span;

    v.frequency = normalised * (MAX_FREQUENCY - MIN_FREQUENCY) + MIN_FREQUENCY;
  });

  return visited;
};

const formatSimpleFlight = (f: FlightData) => {
  return {
    airports: [f.from?.id, f.to?.id],
    route: `${f.from?.iata ?? f.from?.icao ?? 'N/A'} - ${f.to?.iata ?? f.to?.icao ?? 'N/A'}`,
    date: f.date,
    airline: f.airline ?? '',
  };
};

export const formatSeat = (f: FlightData) => {
  const t = (s: string) => toTitleCase(s);

  const userId = page.data.user?.id;
  if (!userId) return null;

  // Look through all legs for the user's seat
  for (const leg of f.legs) {
    const s = leg.seats.find((seat) => seat.userId === userId);
    if (!s) continue;

    if (s.seat && s.seatNumber && s.seatClass) {
      return `${t(s.seatClass)} (${s.seat} ${s.seatNumber})`;
    }
    if (s.seat && s.seatNumber) {
      return `${s.seat} ${s.seatNumber}`;
    }
    if (s.seat && s.seatClass) {
      return `${t(s.seatClass)} (${s.seat})`;
    }
    if (s.seatClass) {
      return t(s.seatClass);
    }
    if (s.seat) {
      return t(s.seat);
    }
  }

  return null;
};
