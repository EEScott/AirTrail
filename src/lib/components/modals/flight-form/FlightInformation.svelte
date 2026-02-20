<script lang="ts">
  import type { SuperForm } from 'sveltekit-superforms';
  import { z } from 'zod';

  import { AircraftField, AirlineField } from '$lib/components/form-fields';
  import * as Form from '$lib/components/ui/form';
  import { Input } from '$lib/components/ui/input';
  import { Separator } from '$lib/components/ui/separator';
  import type { flightSchema } from '$lib/zod/flight';

  let {
    form,
    legIndex = 0,
  }: {
    form: SuperForm<z.infer<typeof flightSchema>>;
    legIndex?: number;
  } = $props();
  const { form: formData } = form;
</script>

<section>
  <Separator class="mt-2 mb-3 max-md:hidden" />
  <div class="grid gap-4">
    <div class="grid grid-cols-[2fr_1fr] gap-2">
      <AircraftField {form} {legIndex} />
      <Form.Field {form} name="legs[{legIndex}].aircraftReg" class="flex flex-col">
        <Form.Control>
          {#snippet children({ props })}
            <Form.Label>Registration</Form.Label>
            <Input bind:value={$formData.legs[legIndex].aircraftReg} {...props} />
          {/snippet}
        </Form.Control>
        <Form.FieldErrors />
      </Form.Field>
    </div>
    <AirlineField {form} {legIndex} />
  </div>
</section>
