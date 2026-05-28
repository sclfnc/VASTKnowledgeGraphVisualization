<script setup>
// Drawer section wrapper: rounded white card with a small uppercase title.
// Use as a layout primitive for the per-panel controls drawer.
defineProps({
  title: { type: String, required: true },
  colSpan: { type: [Number, String], default: 1 },
})
</script>

<template>
  <div
    class="rounded-md bg-white px-2 py-1.5 flex flex-col gap-1"
    :class="colSpan == 2 ? 'col-span-2' : ''"
  >
    <div class="flex items-center justify-between">
      <h4 class="text-[9px] font-semibold text-muted uppercase tracking-wider">{{ title }}</h4>
      <slot name="actions" />
    </div>
    <slot />
  </div>
</template>
