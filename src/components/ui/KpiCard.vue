<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useCountUp } from '@/composables/useCountUp'
import { fmtInt, fmtMoney, fmtPct } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    label: string
    value: number | null
    format?: 'money' | 'int' | 'pct'
    tone?: 'auto' | 'none'
    meta?: string
    hint?: string
    clickable?: boolean
  }>(),
  { format: 'money', tone: 'none', clickable: false },
)

const emit = defineEmits<{ click: [] }>()

const animated = useCountUp(toRef(props, 'value'))

const text = computed(() => {
  const value = animated.value
  if (value === null || value === undefined) return '—'
  if (props.format === 'int') return fmtInt(value)
  if (props.format === 'pct') return fmtPct(value)
  return fmtMoney(value)
})

const toneClass = computed(() => {
  if (props.tone !== 'auto') return ''
  const value = props.value ?? 0
  if (value > 0) return 'is-pos'
  if (value < 0) return 'is-neg'
  return ''
})
</script>

<template>
  <div class="kpi fade-up" :class="[toneClass, { 'is-clickable': clickable }]" :tabindex="clickable ? 0 : undefined" @click="clickable && emit('click')" @keydown.enter="clickable && emit('click')">
    <span class="kpi__accent" />
    <div class="kpi__label">{{ label }}</div>
    <div class="kpi__value num">{{ text }}</div>
    <div class="kpi__footer">
      <span v-if="meta" class="kpi__meta">{{ meta }}</span>
      <span v-if="hint" class="kpi__hint">{{ hint }}</span>
    </div>
  </div>
</template>

<style scoped>
.kpi {
  position: relative;
  overflow: hidden;
  padding: 18px 18px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: var(--surface);
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition:
    transform 0.2s var(--ease-out),
    box-shadow 0.2s var(--ease-out);
}

.kpi:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.kpi__accent {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, var(--brand), var(--brand-2));
  opacity: 0.9;
}

.kpi.is-pos .kpi__accent {
  background: linear-gradient(180deg, var(--positive), #4ade80);
}
.kpi.is-neg .kpi__accent {
  background: linear-gradient(180deg, var(--negative), #fb923c);
}

.kpi__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  letter-spacing: 0.02em;
}

.kpi__value {
  font-size: clamp(24px, 2.1vw, 31px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.kpi.is-pos .kpi__value {
  color: var(--positive);
}
.kpi.is-neg .kpi__value {
  color: var(--negative);
}

.kpi__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--text-3);
  min-height: 18px;
}

.kpi__meta {
  font-weight: 600;
  color: var(--text-2);
}

.kpi__hint {
  margin-left: auto;
  color: var(--brand);
  font-weight: 600;
}

.is-clickable {
  cursor: pointer;
}
</style>
