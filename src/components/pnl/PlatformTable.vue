<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PnlFieldDef, PlatformPnl } from '@shared/types'
import { PNL_TABLE_FIELDS, normalizeFieldOrder, pnlFieldValue } from '@shared/types'
import { fmtInt, fmtMoney, fmtPct } from '@/utils/format'
import { useAppStore } from '@/stores/useAppStore'

const props = defineProps<{ platforms: PlatformPnl[]; totals: PlatformPnl | null }>()
const store = useAppStore()

const rows = computed(() => (props.totals ? [...props.platforms, props.totals] : props.platforms))
const fieldMap = new Map(PNL_TABLE_FIELDS.map((field) => [field.key, field]))

const orderedFields = computed(() => {
  const order = normalizeFieldOrder(store.config?.tableFieldOrder)
  return order.map((key) => fieldMap.get(key)).filter((field): field is PnlFieldDef => Boolean(field))
})

const dragKey = ref<string | null>(null)

function cellText(row: PlatformPnl, field: PnlFieldDef): string {
  const value = pnlFieldValue(row, field.key)
  if (field.kind === 'int') return fmtInt(value)
  if (field.kind === 'pct') return fmtPct(value)
  return fmtMoney(value)
}

function isRatioWarn(row: PlatformPnl, field: PnlFieldDef): boolean {
  if (field.warnBelow === undefined) return false
  const value = pnlFieldValue(row, field.key)
  return value !== null && value < field.warnBelow
}

function cellClass(row: PlatformPnl, field: PnlFieldDef): string {
  const value = pnlFieldValue(row, field.key)
  const classes: string[] = []
  if (field.tone === 'muted') classes.push('is-muted')
  if (field.tone === 'cost') classes.push('is-cost')
  if ((field.tone === 'auto' || field.tone === 'emphasis') && value !== null) {
    classes.push(value < 0 ? 'is-negative' : value > 0 ? 'is-positive' : '')
  }
  if (isRatioWarn(row, field)) classes.push('is-warn')
  return classes.filter(Boolean).join(' ')
}

function columnTitle(field: PnlFieldDef): string {
  const hint = field.hint ? `：${field.hint}` : ''
  return `${field.label}${hint}（拖拽表头可调整顺序）`
}

function onDragStart(key: string, event: DragEvent) {
  dragKey.value = key
  event.dataTransfer?.setData('text/plain', key)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDrop(key: string) {
  const source = dragKey.value
  dragKey.value = null
  if (!source || source === key) return
  const order = orderedFields.value.map((field) => field.key)
  const from = order.indexOf(source)
  const to = order.indexOf(key)
  if (from < 0 || to < 0) return
  order.splice(from, 1)
  order.splice(to, 0, source)
  store.setTableFieldOrder(order)
}
</script>

<template>
  <div class="table-wrap">
    <table class="data pnl-table">
      <thead>
        <tr>
          <th class="platform-head">平台</th>
          <th
            v-for="field in orderedFields"
            :key="field.key"
            class="sortable-head"
            :class="{ 'is-dragging': dragKey === field.key }"
            draggable="true"
            :data-field="field.key"
            :title="columnTitle(field)"
            @dragstart="onDragStart(field.key, $event)"
            @dragover.prevent
            @drop.prevent="onDrop(field.key)"
            @dragend="dragKey = null"
          >
            <span class="head-label">{{ field.label }}</span>
            <em v-if="field.warnBelow !== undefined" class="head-benchmark">≥{{ field.warnBelow * 100 }}%</em>
            <span class="head-grip" aria-hidden="true">⋮⋮</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.platform" :class="{ 'is-total': row.platform === '合计' }">
          <td class="platform-cell">{{ row.platform }}</td>
          <td
            v-for="field in orderedFields"
            :key="field.key"
            :class="cellClass(row, field)"
            :data-field="field.key"
            :title="isRatioWarn(row, field) ? `${field.label}低于 ${field.warnBelow! * 100}% 参考线` : undefined"
          >
            {{ cellText(row, field) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.platform-cell {
  font-weight: 700;
}

.pnl-table th,
.pnl-table td {
  padding-left: 9px;
  padding-right: 9px;
}

.pnl-table th.sortable-head {
  cursor: grab;
  user-select: none;
  transition: background 0.14s ease, color 0.14s ease;
}

.pnl-table th.sortable-head:hover {
  background: var(--brand-soft);
  color: var(--text);
}

.pnl-table th.sortable-head.is-dragging {
  opacity: 0.4;
}

.head-label {
  white-space: nowrap;
}

.head-benchmark {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 4px;
  font-style: normal;
  font-size: 9.5px;
  font-weight: 700;
  color: var(--warning);
  background: var(--warning-soft);
  vertical-align: 1px;
}

.head-grip {
  margin-left: 4px;
  font-size: 9px;
  letter-spacing: -2px;
  opacity: 0;
  transition: opacity 0.14s ease;
}

.pnl-table th.sortable-head:hover .head-grip {
  opacity: 0.45;
}

.pnl-table td.is-muted {
  color: var(--text-3);
}

.pnl-table td.is-cost {
  color: var(--negative);
}

.pnl-table td.is-positive {
  color: var(--positive);
}

.pnl-table td.is-negative {
  color: var(--negative);
}

.pnl-table td.is-warn {
  color: var(--warning);
  font-weight: 700;
  background: var(--warning-soft);
}

.pnl-table td[data-field='grossProfit'] {
  font-weight: 700;
}

.pnl-table td[data-field='grossMargin'] {
  font-weight: 700;
}

.is-total .platform-cell {
  color: var(--brand);
}
</style>
