<script setup lang="ts">
import type { Classification, StatusPair } from '@shared/types'
import StatusChip from './StatusChip.vue'
import { fmtMoney } from '@/utils/format'

defineProps<{
  title: string
  tone: Classification
  pairs: StatusPair[]
  totalSales: number
  totalRows: number
  over: boolean
  draggingId: string | null
}>()

const emit = defineEmits<{
  dragover: []
  dragleave: []
  drop: [pairId: string]
  dragstart: [pair: StatusPair]
  dragend: []
  toggle: [pair: StatusPair]
}>()

function onDrop(event: DragEvent) {
  event.preventDefault()
  const pairId = event.dataTransfer?.getData('text/plain') || ''
  if (pairId) emit('drop', pairId)
}
</script>

<template>
  <section
    class="column"
    :class="[`column--${tone}`, { 'is-over': over }]"
    @dragover.prevent="emit('dragover')"
    @dragleave.self="emit('dragleave')"
    @drop.prevent="onDrop"
  >
    <header class="column__head">
      <div class="column__title">
        <span class="column__dot" />
        {{ title }}
        <span class="column__count num">{{ pairs.length }}</span>
      </div>
      <div class="column__totals num">
        <strong>{{ fmtMoney(totalSales) }}</strong>
        <span>{{ totalRows }} 行</span>
      </div>
    </header>

    <div class="column__list">
      <StatusChip
        v-for="pair in pairs"
        :key="pair.id"
        :pair="pair"
        :dragging="draggingId === pair.id"
        @dragstart="emit('dragstart', $event)"
        @dragend="emit('dragend')"
        @toggle="emit('toggle', pair)"
      />
      <div v-if="!pairs.length" class="column__empty">
        <span>{{ tone === 'settle' ? '暂无预估结算订单' : '暂无退款订单' }}</span>
        <small>拖拽卡片到此处即可归类</small>
      </div>
    </div>
  </section>
</template>

<style scoped>
.column {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-lg);
  border: 1px dashed var(--line-strong);
  background: var(--surface-muted);
  min-height: 260px;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.column.is-over {
  border-color: var(--brand);
  background: var(--brand-soft);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.column--settle.is-over {
  border-color: var(--positive);
  background: var(--positive-soft);
  box-shadow: 0 0 0 3px var(--positive-soft);
}

.column--refund.is-over {
  border-color: var(--negative);
  background: var(--negative-soft);
  box-shadow: 0 0 0 3px var(--negative-soft);
}

.column__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 0 2px;
}

.column__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 800;
}

.column__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--positive);
}

.column--refund .column__dot {
  background: var(--negative);
}

.column__count {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--surface-solid);
  border: 1px solid var(--line);
  font-size: 11px;
  color: var(--text-3);
}

.column__totals {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-3);
}

.column__totals strong {
  font-size: 13px;
  color: var(--text);
}

.column__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;
}

.column__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 1;
  min-height: 160px;
  color: var(--text-3);
  font-size: 12.5px;
  text-align: center;
  border-radius: var(--radius-md);
  background: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 8px,
    rgba(127, 127, 127, 0.04) 8px,
    rgba(127, 127, 127, 0.04) 16px
  );
}

.column__empty small {
  font-size: 11px;
  opacity: 0.8;
}

@media (max-width: 860px) {
  .column__list {
    max-height: 420px;
  }
}
</style>
