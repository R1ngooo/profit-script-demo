<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { MissingCost } from '@shared/types'
import { COST_TEMPLATE_URL, api, type CostImportResponse } from '@/api/client'
import { useAppStore } from '@/stores/useAppStore'
import NumberField from '@/components/ui/NumberField.vue'
import { fmtInt, fmtMoney, fmtNumber } from '@/utils/format'

const store = useAppStore()
const search = ref('')
const drafts = reactive<Record<string, number | null>>({})
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const dragging = ref(false)
const importResult = ref<CostImportResponse | null>(null)
const importError = ref('')

function keyOf(item: MissingCost): string {
  return item.sku || `name:${item.productName}`
}

watch(
  () => store.missingCosts,
  (list) => {
    for (const item of list) {
      const key = keyOf(item)
      if (!(key in drafts)) drafts[key] = item.override
    }
  },
  { immediate: true },
)

const rows = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return store.missingCosts
  return store.missingCosts.filter((item) =>
    `${item.sku} ${item.productName} ${item.platforms.join(' ')}`.toLowerCase().includes(keyword),
  )
})

const suggestionCount = computed(() => store.missingCosts.filter((item) => item.suggestion !== null).length)

function update(item: MissingCost, value: number | null) {
  const key = keyOf(item)
  drafts[key] = value
  if (!item.sku) return
  store.setCustomCost(item.sku, value)
}

function adopt(item: MissingCost) {
  if (item.suggestion === null || !item.sku) return
  update(item, Math.round(item.suggestion * 10000) / 10000)
}

function adoptAll() {
  for (const item of store.missingCosts) {
    if (item.suggestion !== null && item.sku && drafts[keyOf(item)] == null) adopt(item)
  }
}

function pickFile() {
  fileInput.value?.click()
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      resolve(text.includes(',') ? text.slice(text.indexOf(',') + 1) : text)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

async function importFile(file: File | null | undefined) {
  if (!file || importing.value) return
  if (!/\.xlsx$/i.test(file.name)) {
    store.notify('请上传 .xlsx 格式的 Excel 文件（不支持 .xls / CSV）', 'error')
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    store.notify('文件过大（超过 6MB），请精简后再上传', 'error')
    return
  }
  importing.value = true
  importError.value = ''
  try {
    const dataBase64 = await readBase64(file)
    const result = await api.importCosts(file.name, dataBase64)
    importResult.value = result
    if (!result.matched.length) {
      store.notify(
        `未匹配到已知 SKU（解析 ${result.parsedRows} 行，忽略 ${result.unknownCount + result.invalidCount} 行）`,
        'error',
      )
      return
    }
    const count = store.applyImportedCosts(result.matched)
    store.notify(`已导入 ${count} 个 SKU 成本（草稿），正在实时预览；确认后请点「提交并保存」`, 'success')
  } catch (error) {
    importError.value = error instanceof Error ? error.message : '导入失败'
    store.notify(`批量补录失败：${importError.value}`, 'error')
  } finally {
    importing.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  void importFile(input.files?.[0])
}

function onDrop(event: DragEvent) {
  dragging.value = false
  void importFile(event.dataTransfer?.files?.[0])
}

function clearImport() {
  importResult.value = null
  importError.value = ''
}
</script>

<template>
  <div
    id="missing-costs"
    class="subcard missing"
    :class="{ 'is-dragging': dragging }"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="subcard__head">
      <h3>缺失成本补录</h3>
      <span class="badge" :class="store.missingCosts.length ? 'badge--warning' : 'badge--positive'">
        {{ store.missingCosts.length }} 个 SKU
      </span>
      <span v-if="suggestionCount" class="badge badge--info">{{ suggestionCount }} 个有建议价</span>
      <div class="missing__actions">
        <a v-if="store.missingCosts.length" class="btn btn--ghost btn--sm" :href="COST_TEMPLATE_URL" download>
          下载补录模板
        </a>
        <button class="btn btn--soft btn--sm" type="button" :disabled="importing" @click="pickFile">
          {{ importing ? '解析中…' : 'Excel 批量补录' }}
        </button>
        <input
          id="cost-import-input"
          ref="fileInput"
          class="missing__file"
          type="file"
          accept=".xlsx"
          aria-label="选择批量补录 Excel"
          @change="onFileChange"
        />
        <input v-model="search" class="missing__search" type="search" placeholder="搜索 SKU / 商品名…" aria-label="搜索缺失成本" />
        <button class="btn btn--soft btn--sm" type="button" :disabled="!suggestionCount" @click="adoptAll">全部采纳建议</button>
      </div>
    </div>
    <p class="subcard__desc">
      成本表未匹配到的 SKU 默认按 0 计成本，会高估毛利。可逐行填写单价，也可下载模板或直接拖入 Excel
      批量补录：只需「商品编码（SKU）」与「成本价」两列，其余列（商品名/款式/平台/备注等）可忽略；导入后先按草稿实时预览，点面板右上角「提交并保存」后写入配置。
    </p>

    <div v-if="dragging" class="missing__drop">松开鼠标，导入 .xlsx 补录表</div>

    <div v-if="importResult" class="missing__import" :class="{ 'is-warn': !importResult.matched.length }">
      <div class="missing__import-main">
        <strong v-if="importResult.matched.length">已导入 {{ importResult.matched.length }} 个 SKU 成本</strong>
        <strong v-else>未匹配到已知 SKU</strong>
        <span>解析 {{ importResult.parsedRows }} 行</span>
        <span v-if="importResult.unknownCount">忽略未知 SKU {{ importResult.unknownCount }} 行</span>
        <span v-if="importResult.invalidCount">无效成本 {{ importResult.invalidCount }} 行</span>
        <span v-if="importResult.matched.length" class="badge badge--warning">草稿未保存</span>
        <span v-if="importResult.fileName" class="missing__import-file">{{ importResult.fileName }}</span>
        <button class="btn btn--ghost btn--sm missing__import-close" type="button" @click="clearImport">关闭</button>
      </div>
      <div v-if="importResult.warnings.length" class="missing__import-warn">{{ importResult.warnings.join('；') }}</div>
      <div v-if="importResult.unknown.length" class="missing__import-unknown">
        未知 SKU：{{ importResult.unknown.slice(0, 8).map((item) => item.sku).join('、') }}
        <span v-if="importResult.unknownCount > 8">等 {{ importResult.unknownCount }} 个</span>
      </div>
    </div>

    <div v-if="importError" class="missing__import is-error">
      <div class="missing__import-main">
        <strong>导入失败</strong>
        <span>{{ importError }}</span>
        <button class="btn btn--ghost btn--sm missing__import-close" type="button" @click="clearImport">关闭</button>
      </div>
    </div>

    <div v-if="!store.missingCosts.length" class="missing__empty">
      <span class="missing__check">✓</span>
      <div>
        <strong>所有结算订单均已匹配成本</strong>
        <p>成本覆盖率 {{ store.totals?.costCoverage === null || store.totals?.costCoverage === undefined ? '—' : `${(store.totals.costCoverage * 100).toFixed(1)}%` }}</p>
      </div>
    </div>

    <div v-else class="table-wrap missing__table">
      <table class="data">
        <thead>
          <tr>
            <th>SKU 编码</th>
            <th>商品名称</th>
            <th>平台</th>
            <th>结算数量</th>
            <th>销售额</th>
            <th>建议单价</th>
            <th>补录单价</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rows" :key="keyOf(item)">
            <td class="sku-cell mono" :title="item.sku || '（空 SKU）'">{{ item.sku || '（空 SKU）' }}</td>
            <td class="name-cell" :title="item.productName">{{ item.productName || '—' }}</td>
            <td class="platform-cell">
              <span v-for="platform in item.platforms" :key="platform" class="badge">{{ platform }}</span>
            </td>
            <td>{{ fmtInt(item.settledQty) }}</td>
            <td>{{ fmtMoney(item.sales) }}</td>
            <td class="muted">
              <span v-if="item.suggestion !== null">{{ fmtNumber(item.suggestion) }}</span>
              <span v-else>—</span>
            </td>
            <td class="input-cell">
              <NumberField
                :model-value="drafts[keyOf(item)] ?? null"
                :disabled="!item.sku"
                :min="0"
                prefix="¥"
                placeholder="请输入"
                @update:model-value="update(item, $event)"
                @commit="store.saveNow()"
                width="120px"
              />
            </td>
            <td class="action-cell">
              <span v-if="drafts[keyOf(item)] != null" class="badge badge--positive">已补录</span>
              <button v-else-if="item.suggestion !== null && item.sku" class="btn btn--ghost btn--sm" type="button" @click="adopt(item)">
                采纳 {{ fmtNumber(item.suggestion) }}
              </button>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.missing {
  position: relative;
}

.missing.is-dragging {
  outline: 2px dashed var(--brand);
  outline-offset: 4px;
}

.missing__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;
}

.missing__file {
  display: none;
}

.missing__search {
  height: 30px;
  width: 190px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--surface-solid);
  font-size: 12px;
  outline: none;
}

.missing__search:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.missing__drop {
  margin-bottom: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--brand);
  background: var(--brand-soft);
  color: var(--brand-strong, var(--brand));
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.missing__import {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(11, 143, 107, 0.28);
  background: var(--positive-soft);
  color: var(--positive);
  font-size: 12px;
}

.missing__import.is-warn,
.missing__import.is-error {
  border-color: rgba(245, 158, 11, 0.35);
  background: var(--warning-soft);
  color: var(--warning);
}

.missing__import.is-error {
  border-color: rgba(220, 38, 38, 0.3);
  background: var(--negative-soft, rgba(220, 38, 38, 0.08));
  color: var(--negative);
}

.missing__import-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.missing__import-main strong {
  font-size: 12.5px;
}

.missing__import-file {
  opacity: 0.75;
  font-size: 11px;
}

.missing__import-close {
  margin-left: auto;
}

.missing__import-warn,
.missing__import-unknown {
  font-size: 11px;
  opacity: 0.9;
}

.missing__table {
  max-height: 440px;
}

.missing__table table.data td {
  padding: 7px 10px;
}

.sku-cell {
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}

.name-cell {
  max-width: 230px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.platform-cell {
  text-align: left;
  display: flex;
  gap: 4px;
}

.input-cell {
  width: 138px;
}

.action-cell {
  min-width: 120px;
}

.missing__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border-radius: var(--radius-md);
  background: var(--positive-soft);
  color: var(--positive);
}

.missing__check {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.5);
  font-weight: 800;
  font-size: 16px;
  flex: none;
}

.missing__empty strong {
  font-size: 13px;
}

.missing__empty p {
  font-size: 11.5px;
  opacity: 0.85;
  margin-top: 2px;
}

@media (max-width: 860px) {
  .missing__actions {
    width: 100%;
    margin-left: 0;
  }
  .missing__search {
    width: 100%;
  }
}
</style>
