<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useAppStore } from '@/stores/useAppStore'
import { fmtTime } from '@/utils/format'

const store = useAppStore()
const confirmReset = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null

const dirty = computed(() => store.paramDirty)
const changeCount = computed(() => store.pendingChangeCount)

const statusText = computed(() => {
  if (store.saving) return '保存中…'
  if (store.previewing) return '预览计算中…'
  if (dirty.value) return `有 ${changeCount.value} 项修改未保存`
  if (store.lastSavedAt) return `已保存 · ${fmtTime(store.lastSavedAt)}`
  return '参数已加载'
})

const statusTone = computed(() => {
  if (dirty.value) return 'is-dirty'
  if (store.lastSavedAt) return 'is-saved'
  return ''
})

function askReset() {
  confirmReset.value = true
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => {
    confirmReset.value = false
  }, 4000)
}

function cancelReset() {
  confirmReset.value = false
  if (confirmTimer) clearTimeout(confirmTimer)
}

function confirmResetDefaults() {
  cancelReset()
  store.resetParameters()
}

onBeforeUnmount(() => {
  if (confirmTimer) clearTimeout(confirmTimer)
})
</script>

<template>
  <div class="parameter-actions">
    <span class="param-status" :class="statusTone">
      <span class="param-dot" aria-hidden="true" />
      {{ statusText }}
    </span>

    <template v-if="confirmReset">
      <span class="param-confirm-hint">恢复默认参数（尚未保存）？</span>
      <button class="btn btn--sm btn--primary" type="button" @click="confirmResetDefaults">确认恢复</button>
      <button class="btn btn--sm btn--ghost" type="button" @click="cancelReset">取消</button>
    </template>
    <template v-else>
      <button
        class="btn btn--sm btn--ghost"
        type="button"
        :disabled="!dirty || store.saving"
        title="放弃所有未保存的参数修改"
        @click="store.revertParameters()"
      >
        撤销修改
      </button>
      <button class="btn btn--sm" type="button" :disabled="store.saving" title="把人工填写项恢复为默认值（需提交后生效）" @click="askReset">
        恢复默认参数
      </button>
      <button
        class="btn btn--sm btn--primary"
        type="button"
        :disabled="!dirty || store.saving"
        :aria-busy="store.saving"
        @click="store.submitParameters()"
      >
        {{ store.saving ? '保存中…' : '提交并保存' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.parameter-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.param-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--surface-muted);
  border: 1px solid var(--line);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-3);
  white-space: nowrap;
}

.param-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.param-status.is-dirty {
  color: var(--warning);
  border-color: rgba(245, 158, 11, 0.35);
  background: var(--warning-soft);
}

.param-status.is-dirty .param-dot {
  animation: pulse-ring 1.6s infinite;
}

.param-status.is-saved {
  color: var(--positive);
  border-color: rgba(11, 143, 107, 0.3);
  background: var(--positive-soft);
}

.param-confirm-hint {
  font-size: 11.5px;
  color: var(--warning);
  font-weight: 600;
}

.param-status + .btn {
  margin-left: 2px;
}
</style>
