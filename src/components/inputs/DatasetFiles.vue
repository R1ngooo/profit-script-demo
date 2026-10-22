<script setup lang="ts">
import { computed } from 'vue'
import type { FileKind } from '@shared/types'
import { useAppStore } from '@/stores/useAppStore'
import { fmtInt, fmtSeconds } from '@/utils/format'

const store = useAppStore()

const KIND_LABEL: Record<FileKind, string> = {
  order: '订单源',
  cost: '成本表',
  ad: '月消耗表',
  commission: '商务订单',
}

const files = computed(() => store.allFiles)
const warnings = computed(() => store.parseWarnings)
const costColumn = computed(() => store.meta?.costColumnHeader ?? '')
const commissionConnected = computed(() => store.meta?.commissionConnected ?? false)
</script>

<template>
  <div class="subcard">
    <div class="subcard__head">
      <h3>数据文件</h3>
      <span class="badge">{{ files.length }} 个</span>
      <span v-if="costColumn" class="badge badge--info">成本列：{{ costColumn }}</span>
      <span class="badge" :class="commissionConnected ? 'badge--positive' : 'badge--warning'">
        商务订单：{{ commissionConnected ? '已接入' : '未接入' }}
      </span>
      <span v-if="store.appInfo?.packaged" class="badge badge--brand">打包版 v{{ store.appInfo.version }}</span>
      <button class="btn btn--ghost btn--sm" type="button" :disabled="store.refreshing" @click="store.refreshData()">重新解析</button>
    </div>

    <div class="file-list">
      <div v-for="file in files" :key="file.path" class="file-row" :class="{ 'is-error': file.error }">
        <span class="file-kind">{{ KIND_LABEL[file.kind] }}</span>
        <div class="file-main">
          <strong :title="file.path">{{ file.name }}</strong>
          <span class="file-meta num">
            <template v-if="file.error">{{ file.error }}</template>
            <template v-else>
              {{ file.sheet }} · {{ fmtInt(file.rows) }} 行 · {{ fmtSeconds(file.parseMs) }}
              <em v-if="file.cached" class="file-cached">缓存</em>
            </template>
          </span>
        </div>
      </div>
      <div v-if="!files.length" class="file-empty">尚未读取到数据文件</div>
    </div>

    <div v-if="store.appInfo" class="file-paths">
      <div class="file-path">
        <span class="file-path__label">源文件目录</span>
        <code class="file-path__value" :title="store.appInfo.excelDir">{{ store.appInfo.excelDir }}</code>
        <button class="btn btn--ghost btn--sm" type="button" @click="store.openPath('excel')">打开</button>
      </div>
      <div class="file-path">
        <span class="file-path__label">数据 / 缓存</span>
        <code class="file-path__value" :title="store.appInfo.dataDir">{{ store.appInfo.dataDir }}</code>
        <button class="btn btn--ghost btn--sm" type="button" @click="store.openPath('data')">打开</button>
      </div>
      <p class="file-path__hint">Excel 源文件不随应用打包；升级应用时保留数据目录即可继续使用原有参数与缓存。</p>
    </div>

    <div v-if="warnings.length" class="file-warnings">
      <p class="file-warnings__title">解析提示</p>
      <ul>
        <li v-for="(warning, index) in warnings.slice(0, 6)" :key="`${warning.file}-${index}`">
          <strong>{{ warning.file }}</strong>：{{ warning.message }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 250px;
  overflow-y: auto;
}

.file-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface-solid);
}

.file-row.is-error {
  border-color: rgba(221, 63, 107, 0.35);
  background: var(--negative-soft);
}

.file-kind {
  flex: none;
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
}

.file-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.file-main strong {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 11px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 6px;
}

.file-cached {
  font-style: normal;
  font-size: 10px;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--positive-soft);
  color: var(--positive);
  font-weight: 700;
}

.file-empty {
  padding: 14px;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
}

.file-paths {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
}

.file-path {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.file-path__label {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
  width: 78px;
}

.file-path__value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-2);
  background: var(--surface-muted);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 4px 7px;
}

.file-path__hint {
  font-size: 10.5px;
  color: var(--text-3);
  line-height: 1.5;
}

.file-warnings {
  font-size: 11.5px;
  color: var(--warning);
  background: var(--warning-soft);
  border-radius: 10px;
  padding: 10px 12px;
}

.file-warnings__title {
  font-weight: 700;
  margin-bottom: 4px;
}

.file-warnings ul {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
