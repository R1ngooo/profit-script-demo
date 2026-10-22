<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Classification, StatusPair } from '@shared/types'
import { useAppStore } from '@/stores/useAppStore'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusColumn from './StatusColumn.vue'
import RuleLegend from './RuleLegend.vue'
import { fmtMoney, fmtPct, fmtInt } from '@/utils/format'

const store = useAppStore()

const search = ref('')
const showRules = ref(false)
const draggingId = ref<string | null>(null)
const dragOver = ref<Classification | null>(null)

const platforms = computed(() => (store.orderPlatforms.length ? store.orderPlatforms : store.includedPlatforms))

watch(
  platforms,
  (names) => {
    if (names.length && !names.includes(store.activePlatform)) store.activePlatform = names[0]
  },
  { immediate: true },
)

const activePlatform = computed(() => store.activePlatform || platforms.value[0] || '')

const platformPairs = computed(() => store.statusPairs.filter((pair) => pair.platform === activePlatform.value))

const filteredPairs = computed(() => {
  const keyword = search.value.trim()
  if (!keyword) return platformPairs.value
  return platformPairs.value.filter((pair) =>
    `${pair.orderStatus} ${pair.afterSaleStatus} ${pair.reason}`.toLowerCase().includes(keyword.toLowerCase()),
  )
})

const settlePairs = computed(() => filteredPairs.value.filter((pair) => pair.effective === 'settle'))
const refundPairs = computed(() => filteredPairs.value.filter((pair) => pair.effective === 'refund'))

const settleSales = computed(() => settlePairs.value.reduce((sum, pair) => sum + pair.sales, 0))
const refundSales = computed(() => refundPairs.value.reduce((sum, pair) => sum + pair.sales, 0))
const settleRows = computed(() => settlePairs.value.reduce((sum, pair) => sum + pair.rows, 0))
const refundRows = computed(() => refundPairs.value.reduce((sum, pair) => sum + pair.rows, 0))

const manualCount = computed(() => platformPairs.value.filter((pair) => pair.overridden).length)
const unknownCount = computed(() => platformPairs.value.filter((pair) => pair.unknown && !pair.overridden).length)
const overrideCount = computed(() => store.statusPairs.filter((pair) => pair.overridden).length)

const refundRatio = computed(() => {
  const total = settleSales.value + refundSales.value
  return total > 0 ? refundSales.value / total : null
})

function manualCountFor(platform: string): number {
  return store.statusPairs.filter((pair) => pair.platform === platform && pair.overridden).length
}

function onDragStart(pair: StatusPair) {
  draggingId.value = pair.id
}

function onDragEnd() {
  draggingId.value = null
  dragOver.value = null
}

function onDrop(pairId: string, classification: Classification) {
  dragOver.value = null
  const pair = store.statusPairs.find((item) => item.id === pairId)
  if (!pair || pair.effective === classification) return
  void store.setPairClassification(pair, classification)
}

function onToggle(pair: StatusPair) {
  void store.setPairClassification(pair, pair.effective === 'settle' ? 'refund' : 'settle')
}
</script>

<template>
  <SectionCard index="Ⅰ" title="状态判定关系" :sub="`按订单状态 × 售后状态推理预估结算 / 退款；拖拽卡片即可人工改判，结果实时重算并持久化`">
    <template #title-extra>
      <span class="badge">{{ platformPairs.length }} 组状态</span>
      <span v-if="unknownCount" class="badge badge--warning">{{ unknownCount }} 组待确认</span>
    </template>
    <template #actions>
      <input v-model="search" class="board-search" type="search" placeholder="搜索订单状态 / 售后状态…" aria-label="搜索状态组合" />
      <button v-if="manualCount" class="btn btn--soft btn--sm" type="button" @click="store.resetPairs(activePlatform)">
        恢复自动判定（{{ manualCount }}）
      </button>
      <button class="btn btn--ghost btn--sm" type="button" @click="showRules = !showRules">
        {{ showRules ? '收起规则' : '规则说明' }}
      </button>
    </template>

    <div class="platform-tabs" role="tablist" aria-label="平台切换">
      <button
        v-for="name in platforms"
        :key="name"
        type="button"
        role="tab"
        class="platform-tab"
        :class="{ 'is-active': name === activePlatform }"
        :aria-selected="name === activePlatform"
        @click="store.activePlatform = name"
      >
        <span>{{ name }}</span>
        <span v-if="manualCountFor(name)" class="badge badge--brand">{{ manualCountFor(name) }} 手动</span>
      </button>
    </div>

    <div class="board-note">
      <span class="board-note__icon" aria-hidden="true">⇄</span>
      将状态卡片拖入另一列即可归类；也可以聚焦卡片后按空格键，或点卡片右下角按钮切换。
    </div>

    <Transition name="rules">
      <RuleLegend v-if="showRules" />
    </Transition>

    <div class="board-grid">
      <StatusColumn
        title="预估结算"
        tone="settle"
        :pairs="settlePairs"
        :total-sales="settleSales"
        :total-rows="settleRows"
        :over="dragOver === 'settle'"
        :dragging-id="draggingId"
        @dragover="dragOver = 'settle'"
        @dragleave="dragOver = null"
        @drop="onDrop($event, 'settle')"
        @dragstart="onDragStart"
        @dragend="onDragEnd"
        @toggle="onToggle"
      />
      <StatusColumn
        title="退款订单"
        tone="refund"
        :pairs="refundPairs"
        :total-sales="refundSales"
        :total-rows="refundRows"
        :over="dragOver === 'refund'"
        :dragging-id="draggingId"
        @dragover="dragOver = 'refund'"
        @dragleave="dragOver = null"
        @drop="onDrop($event, 'refund')"
        @dragstart="onDragStart"
        @dragend="onDragEnd"
        @toggle="onToggle"
      />
    </div>

    <footer class="board-foot">
      <span>当前平台：<strong>{{ activePlatform || '—' }}</strong></span>
      <span>预估结算 <strong class="num">{{ fmtMoney(settleSales) }}</strong>（{{ fmtInt(settleRows) }} 行）</span>
      <span>退款 <strong class="num">{{ fmtMoney(refundSales) }}</strong>（{{ fmtInt(refundRows) }} 行）</span>
      <span>退款占比 <strong class="num">{{ fmtPct(refundRatio) }}</strong></span>
      <span v-if="overrideCount" class="board-foot__manual">全局手动归类 {{ overrideCount }} 组</span>
    </footer>
  </SectionCard>
</template>

<style scoped>
.board-search {
  height: 32px;
  width: 210px;
  max-width: 100%;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface-solid);
  outline: none;
  font-size: 12.5px;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.board-search:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.platform-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.platform-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  border-radius: 11px;
  border: 1px solid var(--line);
  background: var(--surface-solid);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  transition: all 0.16s var(--ease-out);
}

.platform-tab:hover {
  border-color: var(--line-strong);
  transform: translateY(-1px);
}

.platform-tab.is-active {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--brand), #8f7bff 60%, var(--brand-2));
  box-shadow: 0 12px 24px -14px rgba(109, 94, 248, 0.9);
}

.platform-tab.is-active .badge {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  border-color: transparent;
}

.board-note {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-3);
  padding: 9px 12px;
  border-radius: 11px;
  background: var(--brand-soft);
  color: var(--brand);
}

.board-note__icon {
  font-weight: 800;
}

.board-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.board-foot {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-3);
  border-top: 1px solid var(--line);
  padding-top: 14px;
}

.board-foot strong {
  color: var(--text);
}

.board-foot__manual {
  margin-left: auto;
  color: var(--brand);
  font-weight: 600;
}

.rules-enter-active,
.rules-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.rules-enter-from,
.rules-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 900px) {
  .board-grid {
    grid-template-columns: 1fr;
  }
  .board-search {
    width: 100%;
  }
}
</style>
