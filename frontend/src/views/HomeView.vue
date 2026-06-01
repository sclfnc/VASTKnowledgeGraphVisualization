<script setup>
// All dashboard nested views have a left sidebar and a body with panels
import { RouterView } from 'vue-router';
import { useAboutModal } from '@/composables/useAboutModal';
import AppSidebar from '@/components/AppSidebar.vue';
import AboutModal from '@/components/AboutModal.vue';
import TimelineParsingSettingsModal from '@/components/TimelineParsingSettingsModal.vue';

const { open: aboutOpen, closeAbout } = useAboutModal();
</script>

<template>
  <AppSidebar />
  <main class="w-full pb-4 pt-3 md:pb-6 md:pt-3 pl-[316px] pr-4 md:pr-6">
    <RouterView />
  </main>

  <AboutModal :open="aboutOpen" @close="closeAbout" />
  <TimelineParsingSettingsModal />
</template>
