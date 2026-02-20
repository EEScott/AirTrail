<script lang="ts">
  import { differenceInSeconds } from 'date-fns';
  import { Plus, X } from '@o7/icon/lucide';
  import type { Infer, SuperForm } from 'sveltekit-superforms';

  import FlightInformation from './FlightInformation.svelte';
  import FlightNumber from './FlightNumber.svelte';
  import SeatInformation from './SeatInformation.svelte';
  import FlightTimetable from './FlightTimetable.svelte';

  import { AirportField, DateTimeField } from '$lib/components/form-fields';
  import { Button } from '$lib/components/ui/button';
  import * as Form from '$lib/components/ui/form';
  import * as Select from '$lib/components/ui/select';
  import { Input, Textarea } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import { FlightReasons } from '$lib/db/types';
  import { cn, toTitleCase } from '$lib/utils';
  import { mergeTimeWithDate } from '$lib/utils/datetime';
  import type { flightSchema } from '$lib/zod/flight';

  let {
    form,
  }: {
    form: SuperForm<Infer<typeof flightSchema>>;
  } = $props();

  const { form: formData } = form;

  const MAX_DURATION_SECONDS = 24 * 60 * 60;

  const timetableDateFields = [
    'departureScheduled',
    'arrivalScheduled',
    'takeoffScheduled',
    'takeoffActual',
    'landingScheduled',
    'landingActual',
  ] as const;

  const timetableTimeFields = [
    'departureScheduledTime',
    'arrivalScheduledTime',
    'takeoffScheduledTime',
    'takeoffActualTime',
    'landingScheduledTime',
    'landingActualTime',
  ] as const;

  let showTimetable: boolean[] = $state([false]);
  let prevHasTimetableData: boolean[] = $state([false]);

  const legHasTimetableData = (legIndex: number) => {
    const leg = $formData.legs[legIndex];
    if (!leg) return false;
    const legAny = leg as Record<string, any>;
    return (
      timetableDateFields.some((field) => !!legAny[field]) ||
      timetableTimeFields.some((field) => !!legAny[field])
    );
  };

  // Track previous departure dates to detect user changes (non-reactive)
  const prevDepartures: (string | null | undefined)[] = [];

  // Auto-populate arrival date when departure date is entered
  $effect(() => {
    for (let i = 0; i < $formData.legs.length; i++) {
      const leg = $formData.legs[i];
      if (!leg) continue;
      const dep = leg.departure ?? null;
      const prevDep = prevDepartures[i];

      // Only auto-fill when departure changes from its previous tracked value.
      // Skip on first track (prevDep === undefined) to avoid filling on form load.
      if (prevDep !== undefined && dep && dep !== prevDep && !leg.arrival) {
        $formData.legs[i]!.arrival = dep;
      }

      prevDepartures[i] = dep;
    }
  });

  // Auto-open timetable when data is populated (e.g., from flight lookup)
  $effect(() => {
    for (let i = 0; i < $formData.legs.length; i++) {
      const has = legHasTimetableData(i);
      if (has && !(prevHasTimetableData[i] ?? false)) {
        showTimetable[i] = true;
      }
      prevHasTimetableData[i] = has;
    }
  });

  const legDurationWarning = (legIndex: number): string | null => {
    const leg = $formData.legs[legIndex];
    if (!leg) return null;
    const { departure, departureTime, arrival, arrivalTime, from, to } = leg;
    if (
      !departure ||
      !departureTime ||
      !arrival ||
      !arrivalTime ||
      !from ||
      !to
    ) {
      return null;
    }
    try {
      const dep = mergeTimeWithDate(departure, departureTime, from.tz);
      const arr = mergeTimeWithDate(arrival, arrivalTime, to.tz);
      const duration = differenceInSeconds(arr, dep);
      if (duration > MAX_DURATION_SECONDS) {
        return 'Flight duration exceeds 24 hours';
      }
    } catch {
      return null;
    }
    return null;
  };

  const defaultLeg = () => ({
    from: null,
    to: null,
    departure: null,
    departureTime: null,
    arrival: null,
    arrivalTime: null,
    departureScheduled: null,
    departureScheduledTime: null,
    arrivalScheduled: null,
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
    seats: [
      {
        userId: null,
        guestName: null,
        seat: null,
        seatNumber: null,
        seatClass: null,
      },
    ],
  });

  const addLeg = () => {
    const lastLeg = $formData.legs[$formData.legs.length - 1];
    const legDate = lastLeg?.arrival ?? lastLeg?.departure ?? null;
    $formData.legs = [
      ...$formData.legs,
      {
        ...defaultLeg(),
        from: lastLeg?.to ?? null,
        departure: legDate,
        arrival: legDate,
      },
    ];
    showTimetable = [...showTimetable, false];
  };

  const removeLeg = (index: number) => {
    $formData.legs = $formData.legs.filter((_, i) => i !== index);
    showTimetable = showTimetable.filter((_, i) => i !== index);
  };

  const flightReasonLabels: Record<string, string> = {
    leisure: 'Leisure',
    business: 'Business',
    crew: 'Crew',
    other: 'Other',
  };
</script>

{#snippet flightLevelFields()}
  <section>
    <Separator class="mt-2 mb-3 max-md:hidden" />
    <div class="grid gap-4">
      <Form.Field {form} name="flightReason" class="flex flex-col">
        <Form.Control>
          {#snippet children({ props })}
            <Form.Label>Flight Reason</Form.Label>
            <Select.Root
              type="single"
              value={$formData.flightReason ?? undefined}
              onValueChange={(value) => {
                // @ts-expect-error - value is a FlightReason
                $formData.flightReason = FlightReasons.includes(value)
                  ? value
                  : null;
              }}
              allowDeselect
            >
              <Select.Trigger {...props}>
                {$formData.flightReason
                  ? (flightReasonLabels[$formData.flightReason] ??
                    toTitleCase($formData.flightReason))
                  : 'Select reason'}
              </Select.Trigger>
              <Select.Content>
                {#each FlightReasons as reason}
                  <Select.Item
                    value={reason}
                    label={flightReasonLabels[reason] ?? toTitleCase(reason)}
                  />
                {/each}
              </Select.Content>
            </Select.Root>
            <input
              type="hidden"
              value={$formData.flightReason}
              name={props.name}
            />
          {/snippet}
        </Form.Control>
        <Form.FieldErrors />
      </Form.Field>
      <Form.Field {form} name="note" class="flex flex-col">
        <Form.Control>
          {#snippet children({ props })}
            <Form.Label>Note</Form.Label>
            <Textarea
              bind:value={$formData.note}
              placeholder="Add a note..."
              class="resize-none"
              rows={2}
              {...props}
            />
          {/snippet}
        </Form.Control>
        <Form.FieldErrors />
      </Form.Field>
    </div>
  </section>
{/snippet}

{#each $formData.legs as _, legIndex (legIndex)}
  {#if $formData.legs.length > 1}
    <div class="flex items-center justify-between px-6 pt-3 pb-1">
      <h3 class="text-sm font-semibold">
        Leg {legIndex + 1}{#if $formData.legs[legIndex]?.from || $formData.legs[legIndex]?.to}:
          {$formData.legs[legIndex]?.from?.iata ??
            $formData.legs[legIndex]?.from?.icao ??
            '?'}
          &rarr;
          {$formData.legs[legIndex]?.to?.iata ??
            $formData.legs[legIndex]?.to?.icao ??
            '?'}
        {/if}
      </h3>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-muted-foreground hover:text-destructive"
        onclick={() => removeLeg(legIndex)}
      >
        <X size={14} />
      </Button>
    </div>
  {/if}

  <div
    class={cn(
      'grid w-full gap-y-4 md:grid-cols-[3fr_2fr]',
      $formData.legs.length === 1 &&
        'max-md:overflow-auto max-md:max-h-[calc(100dvh-200px)] max-md:min-h-[min(566px,_calc(100dvh-200px))]',
    )}
  >
    <!-- First column: uses contents on mobile to flatten, block on desktop to group -->
    <div
      class={cn(
        'contents md:flex md:flex-col md:gap-4 md:overflow-auto md:scrollbar-hide md:px-6 md:py-4',
        $formData.legs.length === 1 &&
          'md:min-h-[min(566px,_calc(100dvh-200px))] md:max-h-[calc(100dvh-200px)]',
      )}
    >
      <div class="order-1 px-6 md:order-none md:px-0">
        <div class="flex flex-col gap-4 py-4 md:py-0">
          <FlightNumber {form} {legIndex} />
          <AirportField field="from" {form} {legIndex} />
          <AirportField field="to" {form} {legIndex} />
          {#if showTimetable[legIndex]}
            <FlightTimetable {form} {legIndex} />
            <button
              type="button"
              class="text-xs text-muted-foreground transition hover:text-foreground text-left"
              onclick={() => (showTimetable[legIndex] = false)}
            >
              Use simple departure/arrival inputs
            </button>
          {:else}
            <DateTimeField field="departure" {form} {legIndex} />
            <DateTimeField field="arrival" {form} {legIndex} />
            <button
              type="button"
              class="text-xs text-muted-foreground transition hover:text-foreground text-left"
              onclick={() => (showTimetable[legIndex] = true)}
            >
              Add detailed timetable (taxi, takeoff, landing times...)
            </button>
          {/if}
          {#if legDurationWarning(legIndex)}
            <p class="text-yellow-500 text-sm font-medium">
              {legDurationWarning(legIndex)}
            </p>
          {/if}
        </div>
      </div>
      <div class="order-3 px-6 md:order-none md:px-0">
        <div class="flex flex-col gap-4 py-4 md:py-0">
          <FlightInformation {form} {legIndex} />
          {#if legIndex === $formData.legs.length - 1}
            {@render flightLevelFields()}
          {/if}
        </div>
      </div>
    </div>
    <div
      class={cn(
        'order-2 scrollbar-hide px-6 md:order-none md:overflow-auto md:pl-0',
        $formData.legs.length === 1 &&
          'md:max-h-[calc(100dvh-200px)] md:min-h-[min(566px,_calc(100dvh-200px))]',
      )}
    >
      <div class="relative">
        <div
          class="absolute inset-0 rounded-xl border bg-neutral-50 dark:bg-input/30 [mask-image:linear-gradient(to_bottom,black,transparent)]"
        ></div>
        <div class="relative px-4 py-3">
          <SeatInformation {form} {legIndex} />
        </div>
      </div>
    </div>
  </div>

  {#if legIndex < $formData.legs.length - 1}
    <Separator class="my-3 mx-6" />
  {/if}
{/each}

<div class="px-6 py-3">
  <Button type="button" variant="secondary" class="w-full" onclick={addLeg}>
    <Plus size={16} class="mr-1" />
    Add Leg
  </Button>
</div>
