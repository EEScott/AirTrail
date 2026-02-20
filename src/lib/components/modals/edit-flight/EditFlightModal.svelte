<script lang="ts">
  import { SquarePen } from '@o7/icon/lucide';
  import { toast } from 'svelte-sonner';
  import { defaults, type Infer, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';

  import { FlightForm } from '$lib/components/modals/flight-form';
  import { Button } from '$lib/components/ui/button';
  import * as Form from '$lib/components/ui/form';
  import {
    Modal,
    ModalBreadcrumbHeader,
    ModalFooter,
  } from '$lib/components/ui/modal';
  import { trpc } from '$lib/trpc';
  import type { FlightData } from '$lib/utils';
  import { decomposeToLocal, isUsingAmPm } from '$lib/utils/datetime';
  import { flightSchema } from '$lib/zod/flight';

  let {
    flight,
    triggerDisabled = false,
    open = $bindable(false),
    showTrigger = true,
  }: {
    flight: FlightData;
    triggerDisabled?: boolean;
    open?: boolean;
    showTrigger?: boolean;
  } = $props();

  // If their language uses 12-hour time format, we display the time in *a* 12-hour format
  // (not necessarily the user's locale, because our time validator doesn't support all languages).
  const displayLocale = isUsingAmPm() ? 'en-US' : 'fr-FR';

  const buildLegFormData = (rawLeg: (typeof flight.raw.legs)[0]) => {
    const fromTz = rawLeg.from?.tz ?? 'UTC';
    const toTz = rawLeg.to?.tz ?? 'UTC';

    const dep = decomposeToLocal(rawLeg.departure, fromTz, displayLocale);
    const arr = decomposeToLocal(rawLeg.arrival, toTz, displayLocale);
    const depSched = decomposeToLocal(
      rawLeg.departureScheduled,
      fromTz,
      displayLocale,
    );
    const arrSched = decomposeToLocal(
      rawLeg.arrivalScheduled,
      toTz,
      displayLocale,
    );
    const takeoffSched = decomposeToLocal(
      rawLeg.takeoffScheduled,
      fromTz,
      displayLocale,
    );
    const takeoffAct = decomposeToLocal(
      rawLeg.takeoffActual,
      fromTz,
      displayLocale,
    );
    const landingSched = decomposeToLocal(
      rawLeg.landingScheduled,
      toTz,
      displayLocale,
    );
    const landingAct = decomposeToLocal(
      rawLeg.landingActual,
      toTz,
      displayLocale,
    );

    return {
      from: rawLeg.from,
      to: rawLeg.to,
      departure:
        dep.date ??
        (flight.raw.date
          ? new Date(flight.raw.date + 'T00:00:00Z').toISOString()
          : null),
      departureTime: dep.time,
      arrival: arr.date,
      arrivalTime: arr.time,
      departureScheduled: depSched.date,
      departureScheduledTime: depSched.time,
      arrivalScheduled: arrSched.date,
      arrivalScheduledTime: arrSched.time,
      takeoffScheduled: takeoffSched.date,
      takeoffScheduledTime: takeoffSched.time,
      takeoffActual: takeoffAct.date,
      takeoffActualTime: takeoffAct.time,
      landingScheduled: landingSched.date,
      landingScheduledTime: landingSched.time,
      landingActual: landingAct.date,
      landingActualTime: landingAct.time,
      airline: rawLeg.airline,
      flightNumber: rawLeg.flightNumber,
      aircraft: rawLeg.aircraft,
      aircraftReg: rawLeg.aircraftReg,
      departureTerminal: rawLeg.departureTerminal,
      departureGate: rawLeg.departureGate,
      arrivalTerminal: rawLeg.arrivalTerminal,
      arrivalGate: rawLeg.arrivalGate,
      seats: rawLeg.seats.map((s) => ({
        userId: s.userId,
        guestName: s.guestName,
        seat: s.seat,
        seatNumber: s.seatNumber,
        seatClass: s.seatClass,
      })),
    };
  };

  const schemaFlight = {
    flightReason: flight.raw.flightReason,
    note: flight.raw.note,
    legs: flight.raw.legs.map(buildLegFormData),
  };

  const form = superForm(
    defaults<Infer<typeof flightSchema>>(schemaFlight, zod(flightSchema)),
    {
      dataType: 'json',
      id: Math.random().toString(36).substring(7),
      validators: zod(flightSchema),
      onSubmit() {
        $formData.id = flight.id;
      },
      onUpdate({ form }) {
        if (form.message) {
          if (form.message.type === 'success') {
            trpc.flight.list.utils.invalidate();
            toast.success(form.message.text);
            open = false;
            return;
          }
          toast.error(form.message.text);
        }
      },
    },
  );
  const { form: formData, enhance } = form;
</script>

{#if showTrigger}
  <Button
    variant="outline"
    size="icon"
    onclick={() => (open = true)}
    disabled={triggerDisabled}
  >
    <SquarePen size={16} />
  </Button>
{/if}

<Modal bind:open closeOnOutsideClick={false} class="max-w-screen-lg">
  <ModalBreadcrumbHeader
    section="Flights"
    title="Edit flight"
    icon={SquarePen}
  />
  <form method="POST" action="/api/flight/save/form" use:enhance>
    <FlightForm {form} />
    <ModalFooter>
      <Form.Button size="sm">Save</Form.Button>
    </ModalFooter>
  </form>
</Modal>
