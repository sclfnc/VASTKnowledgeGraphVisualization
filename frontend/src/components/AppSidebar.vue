<script setup>
// App sidebar shell — fixed on the left, full height, dark scope.
// Mounted in App.vue whenever a graph is loaded, independent of mode.
import GuideContents from './GuideContents.vue'
</script>

<template>
  <aside class="surface-dark-raised fixed left-0 top-0 z-30 h-screen w-[18rem] overflow-hidden border-r border-dark">
    <div class="scrollbar-slim h-full overflow-y-auto px-4 py-3">
      <GuideContents />
    </div>
  </aside>
</template>
