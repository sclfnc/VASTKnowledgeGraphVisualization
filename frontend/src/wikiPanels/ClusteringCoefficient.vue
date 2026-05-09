<script setup>
import { PANEL_PROPS } from './panelProps.js'
import { usePanel } from './usePanel.js'
import PanelShell from './PanelShell.vue'

const props = defineProps(PANEL_PROPS)
const { ownSpec, controls, explanation, updateControl } = usePanel(props)
</script>

<template>
  <PanelShell
    :explanation="explanation"
    :controls-schema="ownSpec?.controlsSchema"
    :controls="controls"
    :show-explanation="showExplanation"
    @update="updateControl"
  >
    <div class="w-full bg-white rounded border border-slate-200 flex items-center justify-center text-slate-500" style="height: 400px;">
      Placeholder: ClusteringCoefficient
    </div>
  </PanelShell>
</template>
