<script lang="ts">
  import { isAfter, isBefore } from 'date-fns';
  import { toast } from 'svelte-sonner';

  import {
    defaultFilters,
    defaultTempFilters,
    type FlightFilters,
    type TempFilters,
    type Route,
  } from '$lib/components/flight-filters/types';
  import FlightsOnboarding from '$lib/components/onboarding/FlightsOnboarding.svelte';
  import { Map } from '$lib/components/map';
  import { ListFlightsModal, StatisticsModal } from '$lib/components/modals';
  import { openModalsState } from '$lib/state.svelte';
  import { trpc } from '$lib/trpc';
  import { prepareFlightData, type FlightData } from '$lib/utils';

  const rawFlights = trpc.flight.list.query();
  const rawVisitedCountries = trpc.visitedCountries.list.query();

  const flights = $derived.by(() => {
    const data = $rawFlights.data;
    if (!data || !data.length) return [];

    return prepareFlightData(data);
  });

  const visitedCountriesData = $derived.by(() => {
    const data = $rawVisitedCountries.data;
    if (!data || !data.length) return [];

    return data;
  });

  let filters: FlightFilters = $state(defaultFilters);
  let tempFilters: TempFilters = $state(defaultTempFilters);

  $effect(() => {
    if (!openModalsState.listFlights) {
      tempFilters = defaultTempFilters;
    }
  });

  const matchesRoute = (f: FlightData, r: Route): boolean => {
    return f.legs.some((leg) => {
      const legFromId = leg.from?.id.toString();
      const legToId = leg.to?.id.toString();
      return (
        (legFromId === r.a && legToId === r.b) ||
        (legFromId === r.b && legToId === r.a)
      );
    });
  };

  const getAllAirportIds = (f: FlightData): string[] => {
    return f.legs
      .flatMap((leg) => [leg.from?.id.toString(), leg.to?.id.toString()])
      .filter((id): id is string => !!id);
  };

  const filteredFlights = $derived.by(() => {
    return flights.filter((f) => {
      const fromId = f.from?.id.toString();
      const toId = f.to?.id.toString();

      if (tempFilters.routes.length || tempFilters.airportsEither.length) {
        if (
          tempFilters.routes.length &&
          !tempFilters.routes.some((r) => matchesRoute(f, r))
        ) {
          return false;
        }
        if (
          tempFilters.airportsEither.length &&
          !getAllAirportIds(f).some((id) =>
            tempFilters.airportsEither.includes(id),
          )
        ) {
          return false;
        }
      } else {
        if (
          filters.departureAirports.length &&
          (!fromId || !filters.departureAirports.includes(fromId))
        ) {
          return false;
        }
        if (
          filters.arrivalAirports.length &&
          (!toId || !filters.arrivalAirports.includes(toId))
        ) {
          return false;
        }
        if (
          filters.airportsEither.length &&
          !getAllAirportIds(f).some((id) =>
            filters.airportsEither.includes(id),
          )
        ) {
          return false;
        }
        if (
          filters.routes.length &&
          !filters.routes.some((r) => matchesRoute(f, r))
        ) {
          return false;
        }
      }

      if (
        filters.fromDate &&
        (!f.date ||
          isBefore(f.date, filters.fromDate.toDate(f.date.timeZone ?? 'UTC')))
      ) {
        return false;
      }
      if (
        filters.toDate &&
        (!f.date ||
          isAfter(f.date, filters.toDate.toDate(f.date.timeZone ?? 'UTC')))
      ) {
        return false;
      }

      if (
        filters.airline.length &&
        !f.legs.some((leg) =>
          filters.airline.includes(leg.airline?.name || ''),
        )
      ) {
        return false;
      }

      if (
        filters.aircraft.length &&
        !f.legs.some((leg) =>
          filters.aircraft.includes(leg.aircraft?.name || ''),
        )
      ) {
        return false;
      }

      if (
        filters.aircraftRegs.length &&
        !f.legs.some((leg) =>
          filters.aircraftRegs.includes(leg.aircraftReg || ''),
        )
      ) {
        return false;
      }

      return true;
    });
  });

  const invalidator = {
    onSuccess: () => {
      trpc.flight.list.utils.invalidate();
    },
  };
  const deleteFlightMutation = trpc.flight.delete.mutation(invalidator);

  const deleteFlight = async (id: number) => {
    const toastId = toast.loading('Deleting flight...');
    try {
      await $deleteFlightMutation.mutateAsync(id);
      toast.success('Flight deleted', { id: toastId });
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete flight', { id: toastId });
    }
  };
</script>

{#if !$rawFlights.isLoading}
  <FlightsOnboarding flightsCount={flights.length} />
{/if}
<ListFlightsModal
  bind:open={openModalsState.listFlights}
  bind:filters
  bind:tempFilters
  {flights}
  {filteredFlights}
  {deleteFlight}
/>
<StatisticsModal
  bind:open={openModalsState.statistics}
  allFlights={filteredFlights}
  visitedCountries={visitedCountriesData}
/>

<Map bind:filters bind:tempFilters {flights} {filteredFlights} />
