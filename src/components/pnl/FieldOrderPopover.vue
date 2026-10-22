<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { PNL_TABLE_FIELDS, normalizeFieldOrder } from '@shared/types'
import { useAppStore } from '@/stores/useAppStore'

const store = useAppStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

const fieldMap = new Map(PNL_TABLE_FIELDS.map((field) => [field.key, field]))
const orderedFields = computed(() =>
  normalizeFieldOrder(store.config?.tableFieldOrder)
    .map((key) => fieldMap.get(key))
    .filter((field): field is NonNullable<typeof field> => Boolean(field)),
)

function move(index: number, delta: number) {
  const target = index + delta
  const order = orderedFields.value.map((field) => field.key)
  if (target < 0 || target >= order.length) return
  const [item] = order.splice(index, 1)
  order.splice(target, 0, item)
  store.setTableFieldOrder(order)
}

function reset() {
  store.resetTableFieldOrder()
}

function onClickOutside(event: MouseEvent) {
  if (!open.value) return
  const target = event.target as Node | null
  if (root.value && target && !root.value.contains(target)) open.value = false
}

onMounted(() => document.addEventListener('click', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="root" class="field-order">
    <button class="btn btn--ghost btn--sm" type="button" :aria-expanded="open" @click="open = !open">
      字段排序
    </button>

    <Transition name="pop">
      <div v-if="open" class="popover" role="dialog" aria-label="自定义字段排序">
        <header class="popover__head">
          <strong>自定义字段排序</strong>
          <span class="muted">平台列固定在最左</span>
        </header>
        <ul class="popover__list">
          <li v-for="(field, index) in orderedFields" :key="field.key" :data-field="field.key">
            <span class="popover__label" :title="field.hint">{{ field.label }}</span>
            <span class="popover__actions">
              <button
                class="popover__btn"
                type="button"
                :disabled="index === 0"
                :aria-label="`${field.label} 上移`"
                @click="move(index, -1)"
              >
                ↑
              </button>
              <button
                class="popover__btn"
                type="button"
                :disabled="index === orderedFields.length - 1"
                :aria-label="`${field.label} 下移`"
                @click="move(index, 1)"
              >
                ↓
              </button>
            </span>
          </li>
        </ul>
        <footer class="popover__foot">
          <button class="btn btn--ghost btn--sm" type="button" @click="reset">重置默认</button>
          <span class="muted">也可直接拖拽表头</span>
        </footer>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.field-order {
  position: relative;
}

.popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 45;
  width: 258px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--surface-solid);
  box-shadow: var(--shadow-lg);
}

.popover__head {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}

.popover__head strong {
  font-size: 12.5px;
}

.popover__head .muted,
.popover__foot .muted {
  font-size: 10.5px;
  color: var(--text-3);
}

.popover__list {
  list-style: none;
  margin: 0;
  padding: 6px 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.popover__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 4px;
  border-radius: 7px;
}

.popover__list li:hover {
  background: var(--surface-muted);
}

.popover__label {
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.popover__actions {
  display: flex;
  gap: 2px;
  flex: none;
}

.popover__btn {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface-solid);
  color: var(--text-2);
  font-size: 11px;
  line-height: 1;
  display: grid;
  place-items: center;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.popover__btn:hover:not(:disabled) {
  background: var(--brand);
  color: #fff;
  border-color: transparent;
}

.popover__btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.popover__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s var(--ease-out);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
