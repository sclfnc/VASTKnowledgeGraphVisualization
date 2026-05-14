<script setup>
// Landing stub for panels in the registry that won't be implemented before release.
// Keeps the entry visible in Contents so the roadmap is explicit.
defineProps({
  panelSpec: { type: Object, required: true },
})
</script>

<template>
  <div class="flex h-full min-h-[8rem] items-center justify-center px-4 py-6">
    <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-400">
      Not implemented
    </span>
  </div>
</template>
