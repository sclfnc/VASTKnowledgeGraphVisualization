<script setup>
defineProps({
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    required: true,
  },
})
</script>

<template>
  <article class="card-elev rounded-2xl p-4">
    <p class="text-xs font-semibold uppercase tracking-wide text-secondary">{{ subtitle }}</p>
    <h3 class="mt-1 text-base font-semibold text-primary">{{ title }}</h3>
    <div class="mt-4 rounded-lg border border-dashed border-slate-300 surface-recessed p-4 text-sm text-secondary">
      <slot />
    </div>
  </article>
</template>

