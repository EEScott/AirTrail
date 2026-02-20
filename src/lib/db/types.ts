import type {
  aircraft,
  airline,
  airport,
  api_key,
  flight,
  leg,
  public_share,
  seat,
  user,
  visited_country,
} from '$lib/db/schema';
import type { Insertable, Selectable } from 'kysely';

export type FullUser = Selectable<user>;
export type User = Omit<FullUser, 'password'>;
export type ApiKey = Omit<Selectable<api_key>, 'key' | 'userId'>;
export type Aircraft = Selectable<aircraft>;
export type Airline = Selectable<airline>;
export type Airport = Selectable<airport>;
export type CreateAirport = Insertable<airport>;
export type Seat = Selectable<seat>;

export type Leg = Omit<
  Selectable<leg>,
  'fromId' | 'toId' | 'aircraftId' | 'airlineId' | 'flightId'
> & {
  from: Airport | null;
  to: Airport | null;
  seats: Seat[];
  aircraft: Aircraft | null;
  airline: Airline | null;
};

export type Flight = Selectable<flight> & {
  legs: Leg[];
};

type CreateFlightAirport = Partial<Airport>;

export type CreateLeg = Omit<Leg, 'id' | 'legOrder' | 'seats'> & {
  from: CreateFlightAirport | null;
  to: CreateFlightAirport | null;
  seats: Omit<Seat, 'legId' | 'id'>[];
};

export type CreateFlight = Omit<Flight, 'id' | 'legs'> & {
  legs: CreateLeg[];
};

export type PublicShare = Selectable<public_share>;
export type VisitedCountry = Selectable<visited_country>;

export function wasVisited(country: Pick<VisitedCountry, 'status'>): boolean {
  return country.status === 'visited' || country.status === 'lived';
}

export const AirportTypes = [
  'small_airport',
  'medium_airport',
  'large_airport',
  'heliport',
  'balloonport',
  'seaplane_base',
  'closed',
] as const;
export const Continents = ['AF', 'AS', 'EU', 'NA', 'OC', 'SA', 'AN'] as const;
export const ContinentMap = {
  EU: 'Europe',
  NA: 'North America',
  SA: 'South America',
  AS: 'Asia',
  AF: 'Africa',
  OC: 'Oceania',
  AN: 'Antarctica',
};

export const SeatTypes = [
  'window',
  'aisle',
  'middle',
  'pilot',
  'copilot',
  'jumpseat',
  'other',
] as const;
export const SeatClasses = [
  'economy',
  'economy+',
  'business',
  'first',
  'private',
] as const;
export const FlightReasons = ['leisure', 'business', 'crew', 'other'] as const;

export const VisitedCountryStatus = [
  'lived',
  'visited',
  'layover',
  'wishlist',
] as const;
