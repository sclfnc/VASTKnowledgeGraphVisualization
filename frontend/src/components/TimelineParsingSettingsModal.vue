<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { X, RotateCcw } from 'lucide-vue-next'

import { useTimelineSettingsModal } from '@/composables/useTimelineSettingsModal.js'
import { useTimelineOverrides } from '@/stores/timelineOverrides.js'
import { useTimeline } from '@/composables/useTimeline.js'
import { useGraphStore } from '@/stores/graph.js'

const { open, closeTimelineSettings } = useTimelineSettingsModal()
const overrides = useTimelineOverrides()
const graphStore = useGraphStore()

const graphIdRef = computed(() => graphStore.graphId)
const { data } = useTimeline(graphIdRef)

// Per-attribute local form state: { strategy: 'auto'|'int_year'|'unix_ts'|'iso_date'|'regex', pattern: string }
const form = reactive({})

// Union of node-scope + edge-scope temporal attributes (single override namespace).
function allAttrs(payload) {
  if (!payload) return []
  return [...new Set([...(payload.temporal_attrs_node ?? []), ...(payload.temporal_attrs_edge ?? [])])]
}

function perAttrFor(payload, attr) {
  if (!payload) return null
  return payload.per_attr_node?.[attr] ?? payload.per_attr_edge?.[attr] ?? null
}

function syncFormFromStore(payload) {
  if (!payload) return
  const stored = overrides.getForGraph(graphStore.graphId)
  for (const attr of allAttrs(payload)) {
    const o = stored[attr]
    if (o?.strategy === 'regex') {
      form[attr] = { strategy: 'regex', pattern: o.pattern ?? '' }
    } else if (o?.strategy) {
      form[attr] = { strategy: o.strategy, pattern: '' }
    } else {
      form[attr] = { strategy: 'auto', pattern: '' }
    }
  }
}

watch(data, (payload) => syncFormFromStore(payload), { immediate: true })
watch(open, (v) => { if (v) syncFormFromStore(data.value) })

const onKeydown = (e) => { if (e.key === 'Escape') closeTimelineSettings() }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const STRATEGY_OPTIONS = [
  { value: 'auto',     label: 'Auto-sniff (default)' },
  { value: 'int_year', label: 'int_year' },
  { value: 'unix_ts',  label: 'unix_ts' },
  { value: 'iso_date', label: 'iso_date' },
  { value: 'regex',    label: 'Custom regex' },
]

// Simple guard against slow/dangerous regex (ReDoS): reject obvious nested
// quantifiers like `(.+)+` or `(.*)*` that can make matching extremely slow.
const REDOS_BLACKLIST = /\((\.\+|\.\*)\)[+*]/
const PATTERN_MAX_LENGTH = 200

const patternErrors = ref({})

function validatePattern(pattern) {
  if (!pattern || pattern.length > PATTERN_MAX_LENGTH) return 'Pattern too long (max 200 chars).'
  if (REDOS_BLACKLIST.test(pattern)) return 'Pattern looks unsafe (nested quantifiers).'
  try {
    const rx = new RegExp(pattern)
    // Need at least one capture group.
    if (!/\(/.test(pattern)) return 'Pattern must include a capture group, e.g. (\\d{4}).'
    // Quick smoke test: ensure rx.exec on a sample doesn't crash.
    rx.exec('test')
  } catch (e) {
    return `Invalid regex: ${e.message}`
  }
  return null
}

function previewRegex(pattern, sample) {
  if (!pattern) return null
  try {
    const m = new RegExp(pattern).exec(String(sample))
    if (!m) return { ok: false, value: null }
    const year = Number(m[1])
    if (Number.isFinite(year)) return { ok: true, value: year }
    return { ok: false, value: null }
  } catch {
    return { ok: false, value: null }
  }
}

function apply(attr) {
  const f = form[attr]
  if (!f) return
  if (f.strategy === 'auto') {
    overrides.setForAttr(graphStore.graphId, attr, null)
    delete patternErrors.value[attr]
    return
  }
  if (f.strategy === 'regex') {
    const err = validatePattern(f.pattern)
    if (err) {
      patternErrors.value = { ...patternErrors.value, [attr]: err }
      return
    }
    delete patternErrors.value[attr]
    overrides.setForAttr(graphStore.graphId, attr, { strategy: 'regex', pattern: f.pattern })
    return
  }
  overrides.setForAttr(graphStore.graphId, attr, { strategy: f.strategy })
  delete patternErrors.value[attr]
}

function resetAll() {
  overrides.clearForGraph(graphStore.graphId)
  syncFormFromStore(data.value)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-[2px]"
      @click.self="closeTimelineSettings()"
    >
      <div class="card-elev relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6">
        <button
          class="absolute right-4 top-4 text-muted hover:text-primary"
          @click="closeTimelineSettings()"
        ><X :size="18" /></button>

        <div class="mb-4">
          <h2 class="text-lg font-semibold text-primary">Date parsing — current graph</h2>
          <p class="text-xs text-secondary">
            Override the year-extraction strategy per temporal attribute. Custom regex must include one capture group for the year.
          </p>
        </div>

        <div v-if="!data" class="text-sm text-muted">Loading temporal attributes…</div>
        <div v-else-if="!allAttrs(data).length" class="text-sm text-muted italic">
          No temporal attributes detected in this graph.
        </div>

        <div v-else class="flex flex-col gap-3">
          <section
            v-for="attr in allAttrs(data)"
            :key="attr"
            class="rounded-lg border border-slate-200 p-3"
          >
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-sm font-semibold text-primary">{{ attr }}</h3>
              <span class="text-[10px] text-muted">
                Detected: <code>{{ perAttrFor(data, attr)?.parse_strategy ?? 'n/a' }}</code>
                ·
                {{ perAttrFor(data, attr)?.valid_count ?? 0 }} / {{ perAttrFor(data, attr)?.eligible_records ?? 0 }} parsed
              </span>
            </div>

            <p class="mb-2 text-[11px] text-secondary">
              Sample:
              <span
                v-for="(s, i) in (perAttrFor(data, attr)?.sample_values ?? [])"
                :key="i"
                class="ml-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
              >{{ s }}</span>
            </p>

            <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <label
                v-for="opt in STRATEGY_OPTIONS" :key="opt.value"
                class="contents cursor-pointer"
              >
                <span class="flex items-center gap-1.5">
                  <input
                    type="radio"
                    :name="`strategy-${attr}`"
                    :value="opt.value"
                    :checked="form[attr]?.strategy === opt.value"
                    @change="form[attr].strategy = opt.value"
                  />
                  <span class="text-secondary">{{ opt.label }}</span>
                </span>
                <div v-if="opt.value === 'regex' && form[attr]?.strategy === 'regex'" class="flex flex-col gap-1">
                  <input
                    type="text" :maxlength="200"
                    placeholder="e.g. (\\d{4})/\\d{2}/\\d{2}"
                    class="input-base w-full px-2 py-1 font-mono text-[11px]"
                    :value="form[attr].pattern"
                    @input="form[attr].pattern = $event.target.value"
                  />
                  <div v-if="form[attr].pattern" class="text-[10px] text-muted">
                    <span class="text-secondary font-semibold">Preview:</span>
                    <span
                      v-for="(s, i) in (perAttrFor(data, attr)?.sample_values ?? [])"
                      :key="i"
                      class="ml-2"
                    >
                      <span class="font-mono">{{ s }}</span>
                      <span :class="previewRegex(form[attr].pattern, s)?.ok ? 'text-emerald-600' : 'text-rose-500'">
                        → {{ previewRegex(form[attr].pattern, s)?.ok ? previewRegex(form[attr].pattern, s).value : '✗' }}
                      </span>
                    </span>
                  </div>
                  <span v-if="patternErrors[attr]" class="text-[10px] text-rose-500">{{ patternErrors[attr] }}</span>
                </div>
                <span v-else />
              </label>
            </div>

            <div class="mt-2 flex justify-end">
              <button
                class="rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-700"
                @click="apply(attr)"
              >Apply to {{ attr }}</button>
            </div>
          </section>
        </div>

        <div class="mt-5 flex items-center justify-between">
          <button
            class="inline-flex items-center gap-1 text-xs text-muted hover:text-rose-500"
            @click="resetAll()"
          ><RotateCcw :size="12" /> Reset all</button>
          <button
            class="rounded-md border border-slate-300 px-3 py-1 text-xs text-secondary hover:bg-slate-50"
            @click="closeTimelineSettings()"
          >Close</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
