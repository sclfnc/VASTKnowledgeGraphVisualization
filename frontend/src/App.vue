<script setup>
import { RouterView } from 'vue-router'
import { computed } from 'vue'
import { useGraphStore } from './stores/graph.js'
import { useAboutModal } from './composables/useAboutModal.js'
import AppSidebar from './components/AppSidebar.vue'
import AboutModal from './components/AboutModal.vue'
import TimelineParsingSettingsModal from './components/TimelineParsingSettingsModal.vue'

const graphStore = useGraphStore()
const { open: aboutOpen, closeAbout } = useAboutModal()

// AppSidebar takes over all chrome (brand, Mode, Dataset, About) whenever
// a graph is loaded. During onboarding the DatasetView card owns its own
// branding header — no top bar needed.
const sidebarActive = computed(() => Boolean(graphStore.graphId))
</script>

<template>
  <div class="min-h-screen surface-recessed">
    <AppSidebar v-if="sidebarActive" />

    <main
      class="w-full pb-4 pt-3 md:pb-6 md:pt-3"
      :class="sidebarActive
        ? 'pl-[19rem] pr-4 md:pr-6'
        : 'mx-auto max-w-[1600px] px-4 md:px-6'"
    >
      <RouterView />
    </main>

    <AboutModal :open="aboutOpen" @close="closeAbout" />
    <TimelineParsingSettingsModal />
  </div>
</template>
