<script setup lang="ts">
import { computed } from 'vue'
import type { StatusPair } from '@shared/types'
import { fmtMoney } from '@/utils/format'

const props = defineProps<{ pair: StatusPair; dragging?: boolean }>()
const emit = defineEmits<{
  dragstart: [pair: StatusPair]
  dragend: []
  toggle: []
}>()

const badgeLabel = computed(() => (props.pair.overridden ? '手动' : props.pair.unknown ? '待确认' : '自动'))
const badgeClass = computed(() =>
  props.pair.overridden ? 'badge--brand' : props.pair.unknown ? 'badge--warning' : 'badge--info',
)

function onDragStart(event: DragEvent) {
  event.dataTransfer?.setData('text/plain', props.pair.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  emit('dragstart', props.pair)
}
</script>

<template>
  <article
    class="chip"
    :class="[`chip--${pair.effective}`, { 'is-dragging': dragging, 'is-manual': pair.overridden }]"
    draggable="true"
    tabindex="0"
    :title="pair.reason"
    @dragstart="onDragStart"
    @dragend="emit('dragend')"
    @keydown.space.prevent="emit('toggle')"
    @keydown.enter.prevent="emit('toggle')"
  >
    <div class="chip__status">
      <span class="chip__order">{{ pair.orderStatus || '（空状态）' }}</span>
      <span class="chip__arrow" aria-hidden="true">→</span>
      <span class="chip__after">{{ pair.afterSaleStatus || '无售后' }}</span>
    </div>
    <div class="chip__meta num">
      <span>{{ pair.rows }} 行</span>
      <span class="chip__sales">{{ fmtMoney(pair.sales) }}</span>
    </div>
    <div class="chip__footer">
      <span class="badge" :class="badgeClass">{{ badgeLabel }}</span>
      <button class="chip__toggle" type="button" title="切换归类（也可直接拖拽）" :aria-label="`切换「${pair.orderStatus} / ${pair.afterSaleStatus || '无售后'}」的归类`" @click.stop="emit('toggle')">
        ⇄
      </button>
    </div>
  </article>
</template>

<style scoped>
.chip {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 13px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--surface-solid);
  box-shadow: var(--shadow-xs);
  cursor: grab;
  transition:
    transform 0.16s var(--ease-out),
    box-shadow 0.16s var(--ease-out),
    border-color 0.16s var(--ease-out),
    opacity 0.16s ease;
  user-select: none;
}

.chip:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
  border-color: var(--line-strong);
}

.chip:active {
  cursor: grabbing;
}

.chip--settle {
  border-left: 3px solid var(--positive);
}

.chip--refund {
  border-left: 3px solid var(--negative);
}

.chip.is-manual {
  background: linear-gradient(180deg, var(--brand-soft), transparent 60%), var(--surface-solid);
}

.chip.is-dragging {
  opacity: 0.35;
  transform: rotate(1.2deg) scale(0.98);
}

.chip__status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 700;
  flex-wrap: wrap;
}

.chip__order {
  color: var(--text);
}

.chip__arrow {
  color: var(--text-3);
  font-weight: 500;
}

.chip__after {
  color: var(--text-2);
  font-weight: 600;
}

.chip__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-3);
}

.chip__sales {
  font-weight: 700;
  color: var(--text-2);
}

.chip__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chip__toggle {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface-muted);
  color: var(--text-2);
  font-size: 12px;
  line-height: 1;
  display: grid;
  place-items: center;
  transition: background 0.14s ease, color 0.14s ease;
}

.chip__toggle:hover {
  background: var(--brand);
  color: #fff;
  border-color: transparent;
}
</style>
