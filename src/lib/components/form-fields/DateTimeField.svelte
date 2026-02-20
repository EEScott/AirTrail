<script lang="ts">
  import { type DateValue, parseDate, Time } from '@internationalized/date';
  import { CalendarDays } from '@o7/icon/lucide';
  import { DateField, TimeField } from 'bits-ui';
  import type { SuperForm } from 'sveltekit-superforms';
  import { z } from 'zod';

  import { Calendar } from '$lib/components/ui/calendar';
  import * as Form from '$lib/components/ui/form';
  import * as Popover from '$lib/components/ui/popover';
  import { HelpTooltip } from '$lib/components/ui/tooltip';
  import { cn, toTitleCase } from '$lib/utils';
  import { dateValueFromISO } from '$lib/utils/datetime';
  import { formatTimeValue, parseTimeValue } from '$lib/utils/datetime/time';
  import type { flightSchema } from '$lib/zod/flight';

  let {
    field,
    form,
    legIndex = 0,
  }: {
    field: 'departure' | 'arrival';
    form: SuperForm<z.infer<typeof flightSchema>>;
    legIndex?: number;
  } = $props();
  const { form: formData, validate } = form;

  const leg = $derived($formData.legs[legIndex]!);
  const fieldName = $derived(`legs[${legIndex}].${field}` as const);
  const timeFieldName = $derived(`legs[${legIndex}].${field}Time` as const);
  const timeKey = $derived(`${field}Time` as const);

  let dateValue: DateValue | undefined = $state(
    leg[field] ? dateValueFromISO(leg[field]) : undefined,
  );

  let timeValue: Time | undefined = $state(
    leg[timeKey]
      ? parseTimeValue(leg[timeKey])
      : undefined,
  );

  $effect(() => {
    if (leg[field]) {
      const date = dateValueFromISO(leg[field]);
      if (!dateValue || date.compare(dateValue) !== 0) {
        dateValue = date;
      }
    } else {
      dateValue = undefined;
    }
  });

  $effect(() => {
    const timeString = leg[timeKey];
    if (timeString) {
      const parsed = parseTimeValue(timeString);
      if (!parsed) {
        timeValue = undefined;
        $formData.legs[legIndex]![timeKey] = null;
        return;
      }

      if (
        !timeValue ||
        parsed.hour !== timeValue.hour ||
        parsed.minute !== timeValue.minute
      ) {
        timeValue = parsed;
      }
    } else {
      timeValue = undefined;
    }
  });
</script>

<div class="grid gap-2 grid-cols-[3fr_2fr] items-start">
  <Form.Field {form} name={fieldName}>
    <Form.Control>
      {#snippet children({ props })}
        <Form.Label>
          {toTitleCase(field)}{field === 'departure' ? ' *' : ''}
        </Form.Label>
        <DateField.Root
          value={dateValue}
          onValueChange={(v) => {
            if (v === undefined) {
              dateValue = undefined;
              $formData.legs[legIndex]![field] = null;
              validate(fieldName);
              return;
            }
            dateValue = v;
            $formData.legs[legIndex]![field] = dateValue
              .toDate('UTC')
              .toISOString();
            validate(fieldName);
          }}
          granularity="day"
          minValue={parseDate('1970-01-01')}
          locale={navigator.language}
        >
          <div class="flex w-full flex-col gap-1.5">
            <DateField.Input
              class={cn(
                'border-input bg-background selection:bg-primary dark:bg-input/30 selection:text-primary-foreground ring-offset-background placeholder:text-muted-foreground shadow-xs flex h-9 w-full min-w-0 rounded-md border px-3 py-[6px] text-base outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
                'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
              )}
            >
              {#snippet children({ segments })}
                {#each segments as { part, value }}
                  <div class="inline-block select-none">
                    {#if part === 'literal'}
                      <DateField.Segment {part} class="text-muted-foreground">
                        {value}
                      </DateField.Segment>
                    {:else}
                      <DateField.Segment
                        {part}
                        class="rounded-md px-1 hover:bg-muted focus:bg-muted focus:text-foreground focus-visible:ring-0! focus-visible:ring-offset-0! aria-[valuetext=Empty]:text-muted-foreground"
                      >
                        {value}
                      </DateField.Segment>
                    {/if}
                  </div>
                {/each}
                <Popover.Root>
                  <Popover.Trigger
                    {...props}
                    class="ml-auto inline-flex items-center justify-center text-muted-foreground transition-all hover:text-foreground active:text-foreground"
                  >
                    <CalendarDays size={16} />
                  </Popover.Trigger>
                  <Popover.Content class="p-0">
                    <Calendar
                      type="single"
                      value={dateValue}
                      onValueChange={(v) => {
                        if (v === undefined) {
                          dateValue = undefined;
                          $formData.legs[legIndex]![field] = null;
                          validate(fieldName);
                          return;
                        }
                        dateValue = v;
                        $formData.legs[legIndex]![field] =
                          dateValue?.toDate('UTC').toISOString() ?? null;
                        validate(fieldName);
                      }}
                    />
                  </Popover.Content>
                </Popover.Root>
              {/snippet}
            </DateField.Input>
          </div>
        </DateField.Root>
        <input hidden bind:value={$formData.legs[legIndex][field]} name={props.name} />
      {/snippet}
    </Form.Control>
    <Form.FieldErrors />
  </Form.Field>
  <Form.Field {form} name={timeFieldName}>
    <Form.Control>
      {#snippet children({ props })}
        <Form.Label class="flex items-center gap-2">
          Time
          <HelpTooltip text="Local airport time." />
        </Form.Label>
        <TimeField.Root
          value={timeValue}
          onValueChange={(value) => {
            if (!value) {
              timeValue = undefined;
              $formData.legs[legIndex]![timeKey] = null;
              validate(timeFieldName);
              return;
            }

            timeValue = value;
            $formData.legs[legIndex]![timeKey] = formatTimeValue(value);
            validate(timeFieldName);
          }}
          granularity="minute"
          locale={navigator.language}
        >
          <div class="flex w-full flex-col gap-1.5">
            <TimeField.Input
              class={cn(
                'border-input bg-background selection:bg-primary dark:bg-input/30 selection:text-primary-foreground ring-offset-background placeholder:text-muted-foreground shadow-xs flex h-9 w-full min-w-0 rounded-md border px-3 py-[6px] text-base outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
                'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
              )}
            >
              {#snippet children({ segments })}
                {#each segments as { part, value }}
                  <div class="inline-block select-none">
                    {#if part === 'literal'}
                      <TimeField.Segment {part} class="text-muted-foreground">
                        {value}
                      </TimeField.Segment>
                    {:else}
                      <TimeField.Segment
                        {part}
                        class="rounded-md px-1 hover:bg-muted focus:bg-muted focus:text-foreground focus-visible:ring-0! focus-visible:ring-offset-0! aria-[valuetext=Empty]:text-muted-foreground"
                      >
                        {value}
                      </TimeField.Segment>
                    {/if}
                  </div>
                {/each}
              {/snippet}
            </TimeField.Input>
          </div>
        </TimeField.Root>
        <input
          hidden
          bind:value={$formData.legs[legIndex][timeKey]}
          name={props.name}
        />
      {/snippet}
    </Form.Control>
    <Form.FieldErrors />
  </Form.Field>
</div>
