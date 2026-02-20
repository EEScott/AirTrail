<script lang="ts">
  import type { SuperForm } from 'sveltekit-superforms';
  import { z } from 'zod';

  import AirlinePicker from './AirlinePicker.svelte';

  import CreateAirline from '$lib/components/modals/settings/pages/data-page/airline/CreateAirline.svelte';
  import * as Form from '$lib/components/ui/form';
  import type { flightSchema } from '$lib/zod/flight';

  let {
    form,
    legIndex = 0,
  }: {
    form: SuperForm<z.infer<typeof flightSchema>>;
    legIndex?: number;
  } = $props();
  const { form: formData } = form;

  const fieldName = $derived(`legs[${legIndex}].airline` as const);

  let createAirline = $state(false);
</script>

<Form.Field {form} name={fieldName} class="flex flex-col">
  <Form.Control>
    {#snippet children({ props })}
      <Form.Label>Airline</Form.Label>
      <AirlinePicker
        bind:value={$formData.legs[legIndex].airline}
        placeholder="Select airline"
        onCreateNew={() => (createAirline = true)}
      />
      <input hidden bind:value={$formData.legs[legIndex].airline} name={props.name} />
    {/snippet}
  </Form.Control>
  <Form.FieldErrors />
</Form.Field>

<CreateAirline bind:open={createAirline} withoutTrigger />
