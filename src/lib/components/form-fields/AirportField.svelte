<script lang="ts">
  import type { SuperForm } from 'sveltekit-superforms';
  import { z } from 'zod';

  import AirportPicker from './AirportPicker.svelte';

  import CreateAirport from '$lib/components/modals/settings/pages/data-page/airport/CreateAirport.svelte';
  import * as Form from '$lib/components/ui/form';
  import { toTitleCase } from '$lib/utils';
  import type { flightSchema } from '$lib/zod/flight';

  let {
    field,
    form,
    legIndex = 0,
  }: {
    field: 'from' | 'to';
    form: SuperForm<z.infer<typeof flightSchema>>;
    legIndex?: number;
  } = $props();
  const { form: formData } = form;

  const fieldName = $derived(`legs[${legIndex}].${field}` as const);

  let createAirport = $state(false);
</script>

<Form.Field {form} name={fieldName} class="flex flex-col">
  <Form.Control>
    {#snippet children({ props })}
      <Form.Label>{toTitleCase(field)} *</Form.Label>
      <AirportPicker
        bind:value={$formData.legs[legIndex][field]}
        placeholder="Choose an airport"
        onCreateNew={() => (createAirport = true)}
      />
      <input hidden bind:value={$formData.legs[legIndex][field]} name={props.name} />
    {/snippet}
  </Form.Control>
  <Form.FieldErrors />
</Form.Field>

<CreateAirport bind:open={createAirport} withoutTrigger />
